import { NextResponse } from "next/server";
import { z } from "zod";
import { createSdkPlugin, listPlugins } from "@/lib/plugin-service";
import { getSession } from "@/lib/session";
import { assertTrustedRequest } from "@/lib/security";

const schema = z.object({
  botId: z.string().uuid(),
  name: z.string().trim().min(2).max(60),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  events: z.array(z.string().min(1)).min(1).max(30),
  permissions: z.array(z.enum(["event:receive", "qq:api"])).max(2).default(["event:receive"]),
});

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  return NextResponse.json({ plugins: listPlugins(user) });
}

export async function POST(request: Request) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "SDK 应用参数不合法", issues: parsed.error.issues }, { status: 400 });
  try { return NextResponse.json(createSdkPlugin(user, parsed.data), { status: 201 }); }
  catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) return NextResponse.json({ message: "SDK 应用标识已存在" }, { status: 409 });
    if (error instanceof Error && error.message === "PLUGIN_QUOTA_EXCEEDED") return NextResponse.json({ message: "SDK 应用数量已达到当前会员套餐上限" }, { status: 409 });
    return NextResponse.json({ message: "SDK 应用创建失败，请检查绑定机器人和应用标识" }, { status: 400 });
  }
}
