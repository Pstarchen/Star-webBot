import { NextResponse } from "next/server";
import { z } from "zod";
import { installPlugin } from "@/lib/hosted-plugin-service";
import { getSession } from "@/lib/session";
import { assertTrustedRequest } from "@/lib/security";

const schema = z.object({
  projectId: z.string().min(1).max(100),
  botId: z.string().uuid(),
  versionId: z.string().min(1).max(100).optional(),
  priority: z.number().int().min(1).max(100).default(50),
});

export async function POST(request: Request) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "插件安装参数不合法", issues: parsed.error.issues }, { status: 400 });
  try { return NextResponse.json(installPlugin(user, parsed.data), { status: 201 }); }
  catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code.includes("UNIQUE")) return NextResponse.json({ message: "该机器人已经安装此插件" }, { status: 409 });
    if (code === "PLUGIN_QUOTA_EXCEEDED") return NextResponse.json({ message: "插件安装数量已达到当前套餐上限" }, { status: 409 });
    if (["BOT_NOT_FOUND", "PLUGIN_PROJECT_NOT_FOUND", "PLUGIN_PROJECT_NOT_AVAILABLE", "PLUGIN_VERSION_NOT_FOUND"].includes(code)) {
      return NextResponse.json({ message: "插件、版本或机器人不存在，或无权安装" }, { status: 404 });
    }
    console.error("Plugin installation failed", {
      name: error instanceof Error ? error.name : typeof error,
      code: code.split(":", 1)[0] || "UNKNOWN_ERROR",
      message: code.slice(0, 1_000) || "UNKNOWN_ERROR",
    });
    return NextResponse.json({ message: "插件安装失败", code: "PLUGIN_INSTALL_FAILED" }, { status: 500 });
  }
}
