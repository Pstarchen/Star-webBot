import { NextResponse } from "next/server";
import { z } from "zod";
import { uninstallPlugin, updatePluginInstallation } from "@/lib/hosted-plugin-service";
import { getSession } from "@/lib/session";
import { assertTrustedRequest } from "@/lib/security";

const schema = z.object({
  enabled: z.boolean().optional(),
  priority: z.number().int().min(1).max(100).optional(),
  versionId: z.string().min(1).max(100).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
}).refine((input) => Object.values(input).some((value) => value !== undefined), "至少提供一个更新字段");

export async function PATCH(request: Request, context: { params: Promise<{ installationId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "插件配置参数不合法", issues: parsed.error.issues }, { status: 400 });
  try {
    updatePluginInstallation(user, (await context.params).installationId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code.startsWith("PLUGIN_CONFIG")) return NextResponse.json({ message: "插件配置校验失败", code }, { status: 400 });
    return NextResponse.json({ message: "插件安装记录或版本不存在" }, { status: 404 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ installationId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  try { uninstallPlugin(user, (await context.params).installationId); return NextResponse.json({ ok: true }); }
  catch { return NextResponse.json({ message: "插件安装记录不存在或无权操作" }, { status: 404 }); }
}

