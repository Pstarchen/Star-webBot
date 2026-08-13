import { NextResponse } from "next/server";
import { getBotRow } from "@/lib/bot-service";
import { gatewayManager } from "@/lib/gateway-manager";
import { isQQApiError } from "@/lib/qq-api";
import { getSession } from "@/lib/session";
import { assertTrustedRequest } from "@/lib/security";

export async function GET(_request: Request, context: { params: Promise<{ botId: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const botId = (await context.params).botId;
  try { getBotRow(user, botId); return NextResponse.json(gatewayManager.status(botId)); }
  catch { return NextResponse.json({ message: "机器人不存在" }, { status: 404 }); }
}

export async function POST(request: Request, context: { params: Promise<{ botId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const botId = (await context.params).botId;
  try {
    const bot = getBotRow(user, botId);
    if (bot.connection_mode !== "websocket") return NextResponse.json({ message: "Webhook 接入模式不需要建立 Gateway 连接" }, { status: 409 });
    return NextResponse.json(await gatewayManager.connect(botId));
  }
  catch (error) {
    if (isQQApiError(error)) return NextResponse.json({ message: error.message, traceId: error.traceId, detail: error.responseBody }, { status: 400 });
    return NextResponse.json({ message: error instanceof Error ? error.message : "Gateway 连接失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ botId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const botId = (await context.params).botId;
  try { getBotRow(user, botId); gatewayManager.disconnect(botId, true, true); return NextResponse.json({ ok: true }); }
  catch { return NextResponse.json({ message: "机器人不存在" }, { status: 404 }); }
}
