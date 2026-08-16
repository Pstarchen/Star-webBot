import { NextResponse } from "next/server";
import { z } from "zod";
import { beginDatabaseInstallation, type DatabaseInstallationHandle } from "@/lib/database";
import { installationDatabaseErrorMessage, installationDatabaseSchema, toDatabaseConfigurationInput } from "@/lib/install-database-schema";
import { assertTrustedRequest, requestUsesHttps } from "@/lib/security";
import { createSessionToken, sessionCookieName, sessionMaxAgeSeconds } from "@/lib/session";
import { completeInstallation } from "@/lib/system-settings-service";

const MAX_ASSET_BYTES = 512 * 1024;
const dataUrlSchema = z.string().startsWith("data:image/").max(MAX_ASSET_BYTES * 2).optional();

const schema = z.object({
  siteName: z.string().trim().min(2).max(40),
  siteTagline: z.string().trim().max(80),
  siteDescription: z.string().trim().min(10).max(300),
  adminName: z.string().trim().min(2).max(40),
  adminEmail: z.email().max(160),
  adminPassword: z.string().min(8).max(128),
  database: installationDatabaseSchema,
  logoDataUrl: dataUrlSchema,
  faviconDataUrl: dataUrlSchema,
});

function parseImageDataUrl(value?: string) {
  if (!value) return undefined;
  const match = /^data:(image\/(?:png|jpeg|webp|x-icon|vnd\.microsoft\.icon));base64,([a-zA-Z0-9+/=]+)$/.exec(value);
  if (!match) throw new Error("INSTALL_ASSET_INVALID");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > MAX_ASSET_BYTES) throw new Error("INSTALL_ASSET_TOO_LARGE");
  return { mimeType: match[1] === "image/vnd.microsoft.icon" ? "image/x-icon" : match[1], bytes };
}

export async function POST(request: Request) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "安装参数不合法", issues: parsed.error.issues }, { status: 400 });

  let databaseInstallation: DatabaseInstallationHandle | null = null;
  try {
    const logo = parseImageDataUrl(parsed.data.logoDataUrl);
    const favicon = parseImageDataUrl(parsed.data.faviconDataUrl);
    databaseInstallation = beginDatabaseInstallation(toDatabaseConfigurationInput(parsed.data.database));
    databaseInstallation.persist();
    const user = completeInstallation({
      ...parsed.data,
      logo,
      favicon,
    });
    databaseInstallation.commit();
    const response = NextResponse.json({ user }, { status: 201 });
    response.cookies.set(sessionCookieName, createSessionToken(user), {
      httpOnly: true,
      sameSite: "lax",
      secure: requestUsesHttps(request),
      path: "/",
      maxAge: sessionMaxAgeSeconds,
    });
    return response;
  } catch (error) {
    databaseInstallation?.rollback();
    const code = error instanceof Error ? error.message : "";
    if (code === "INSTALL_ALREADY_COMPLETED") return NextResponse.json({ message: "系统已完成初始化" }, { status: 409 });
    if (code === "INSTALL_ASSET_INVALID") return NextResponse.json({ message: "站点图片格式不支持" }, { status: 400 });
    if (code === "INSTALL_ASSET_TOO_LARGE") return NextResponse.json({ message: "站点图片不能超过 512KB" }, { status: 400 });
    if (code.includes("UNIQUE")) return NextResponse.json({ message: "管理员邮箱已存在" }, { status: 409 });
    return NextResponse.json({ message: installationDatabaseErrorMessage(error) }, { status: 500 });
  }
}
