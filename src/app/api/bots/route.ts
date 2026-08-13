import { NextResponse } from "next/server";
import { z } from "zod";
import { createBot, listBots } from "@/lib/bot-service";
import { isQQApiError } from "@/lib/qq-api";
import { getSession } from "@/lib/session";
import { assertTrustedRequest } from "@/lib/security";

const createSchema = z.object({
  appId: z.string().trim().min(4).max(80),
  clientSecret: z.string().min(6).max(256),
  environment: z.enum(["production", "sandbox"]),
  connectionMode: z.enum(["websocket", "webhook"]).default("websocket"),
});

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  return NextResponse.json({ bots: listBots(user) });
}

export async function POST(request: Request) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "机器人参数不合法", issues: parsed.error.issues }, { status: 400 });
  try {
    return NextResponse.json({ bot: await createBot(user, parsed.data) }, { status: 201 });
  } catch (error) {
    if (isQQApiError(error)) return NextResponse.json({ message: error.message, traceId: error.traceId, detail: error.responseBody }, { status: 400 });
    if (error instanceof Error && error.message === "QQ_BOT_PROFILE_INVALID") return NextResponse.json({ message: "QQ 未返回有效的机器人资料，请检查应用类型和权限" }, { status: 400 });
    if (error instanceof Error && error.message === "BOT_QUOTA_EXCEEDED") return NextResponse.json({ message: "机器人数量已达到管理员设置的上限" }, { status: 409 });
    if (error instanceof Error && error.message.includes("UNIQUE")) return NextResponse.json({ message: "该 AppID 已添加" }, { status: 409 });
    return NextResponse.json({ message: "机器人添加失败" }, { status: 500 });
  }
}
