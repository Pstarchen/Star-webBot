import { NextResponse } from "next/server";
import { z } from "zod";
import { testPluginApi } from "@/lib/hosted-plugin-service";
import { getSession } from "@/lib/session";
import { assertTrustedRequest } from "@/lib/security";

const schema = z.object({
  definition: z.unknown(),
  sample: z.record(
    z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/),
    z.union([z.string().max(2_000), z.number().finite(), z.boolean()]),
  ).refine((value) => Object.keys(value).length <= 40, "测试变量不能超过 40 项"),
});

export async function POST(request: Request, context: { params: Promise<{ installationId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "API 测试参数不合法", issues: parsed.error.issues }, { status: 400 });
  try {
    return NextResponse.json({ result: await testPluginApi(user, (await context.params).installationId, parsed.data) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "PLUGIN_API_TEST_FAILED";
    if (code === "PLUGIN_CONFIG_PAGE_API_TEST_DENIED") return NextResponse.json({ message: "插件未声明外部 HTTP 权限", code }, { status: 403 });
    if (code.startsWith("PLUGIN_HTTP_") || code.startsWith("PLUGIN_API_TEST_") || error instanceof z.ZodError) {
      return NextResponse.json({ message: "API 测试失败", code }, { status: 400 });
    }
    if (code.includes("PLUGIN_CONFIG_PAGE") || code === "PLUGIN_INSTALLATION_NOT_FOUND") {
      return NextResponse.json({ message: "插件配置页面不存在或无权访问", code }, { status: 404 });
    }
    return NextResponse.json({ message: "API 请求失败", code }, { status: 502 });
  }
}
