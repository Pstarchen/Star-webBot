import { NextResponse } from "next/server";
import { assertTrustedRequest } from "@/lib/security";
import { getSession } from "@/lib/session";
import { SITE_ASSET_MAX_BYTES, SITE_ASSET_MAX_LABEL } from "@/lib/site-assets";
import { setSiteAsset } from "@/lib/system-settings-service";

const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/x-icon", "image/vnd.microsoft.icon"]);

export async function PUT(request: Request, context: { params: Promise<{ kind: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ message: "需要管理员权限" }, { status: 403 });
  const kind = (await context.params).kind;
  if (kind !== "logo" && kind !== "favicon") return NextResponse.json({ message: "未知的站点资产类型" }, { status: 404 });
  const contentType = request.headers.get("content-type")?.split(";")[0].toLowerCase() || "";
  if (!allowedTypes.has(contentType)) return NextResponse.json({ message: "仅支持 PNG、JPEG、WebP 或 ICO 图片" }, { status: 415 });
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > SITE_ASSET_MAX_BYTES) return NextResponse.json({ message: `图片不能超过 ${SITE_ASSET_MAX_LABEL}` }, { status: 413 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > SITE_ASSET_MAX_BYTES) return NextResponse.json({ message: `图片不能为空且不能超过 ${SITE_ASSET_MAX_LABEL}` }, { status: 413 });
  setSiteAsset(user, kind, contentType, bytes);
  return NextResponse.json({ ok: true, url: `/api/site-assets/${kind}?v=${Date.now()}` });
}
