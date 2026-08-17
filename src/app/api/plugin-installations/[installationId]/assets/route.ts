import { NextResponse } from "next/server";
import { z } from "zod";
import { createPluginAsset, deletePluginAsset, listPluginAssets } from "@/lib/hosted-plugin-service";
import { getSession } from "@/lib/session";
import { assertTrustedRequest } from "@/lib/security";

const uploadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1).max(100),
  base64: z.string().min(1).max(28 * 1024 * 1024),
});
const deleteSchema = z.object({ id: z.string().min(1).max(80) });

function assetError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "PLUGIN_CONFIG_PAGE_ASSETS_DENIED") return NextResponse.json({ message: "插件未声明 QQ 媒体权限", code }, { status: 403 });
  if (code.startsWith("PLUGIN_ASSET_")) return NextResponse.json({ message: "媒体文件不合法或不存在", code }, { status: 400 });
  return NextResponse.json({ message: "插件配置页面不存在或无权访问" }, { status: 404 });
}

function publicUrl(request: Request, installationId: string, assetId: string) {
  return new URL(`/api/plugin-assets/${encodeURIComponent(installationId)}/${encodeURIComponent(assetId)}`, request.url).toString();
}

export async function GET(request: Request, context: { params: Promise<{ installationId: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const { installationId } = await context.params;
  try {
    return NextResponse.json({ assets: listPluginAssets(user, installationId).map((asset) => ({ ...asset, url: publicUrl(request, installationId, asset.id) })) });
  } catch (error) { return assetError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ installationId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const parsed = uploadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "媒体上传参数不合法", issues: parsed.error.issues }, { status: 400 });
  const { installationId } = await context.params;
  try {
    const asset = createPluginAsset(user, installationId, parsed.data);
    return NextResponse.json({ asset: { ...asset, url: publicUrl(request, installationId, asset.id) } });
  } catch (error) { return assetError(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ installationId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "媒体删除参数不合法", issues: parsed.error.issues }, { status: 400 });
  try {
    deletePluginAsset(user, (await context.params).installationId, parsed.data.id);
    return NextResponse.json({ ok: true });
  } catch (error) { return assetError(error); }
}
