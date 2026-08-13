import { NextResponse } from "next/server";
import { listBotMediaTargets } from "@/lib/bot-service";
import { getSession } from "@/lib/session";

export async function GET(_request: Request, context: { params: Promise<{ botId: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  try {
    return NextResponse.json({ targets: listBotMediaTargets(user, (await context.params).botId) });
  } catch (error) {
    if (error instanceof Error && error.message === "BOT_NOT_FOUND") return NextResponse.json({ message: "机器人不存在" }, { status: 404 });
    return NextResponse.json({ message: "会话目标加载失败" }, { status: 500 });
  }
}
