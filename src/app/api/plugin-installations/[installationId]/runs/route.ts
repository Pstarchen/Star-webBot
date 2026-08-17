import { NextResponse } from "next/server";
import { listPluginRuns } from "@/lib/hosted-plugin-service";
import { getSession } from "@/lib/session";

export async function GET(request: Request, context: { params: Promise<{ installationId: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const limit = Number(new URL(request.url).searchParams.get("limit") || 50);
  try {
    return NextResponse.json({ runs: listPluginRuns(user, (await context.params).installationId, Number.isFinite(limit) ? limit : 50) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "PLUGIN_CONFIG_PAGE_RUNS_DENIED") return NextResponse.json({ message: "插件未声明运行日志权限", code }, { status: 403 });
    return NextResponse.json({ message: "插件配置页面不存在或无权访问" }, { status: 404 });
  }
}
