import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteBot, getBotRow, updateBotConnectionMode } from "@/lib/bot-service";
import { gatewayManager } from "@/lib/gateway-manager";
import { getSession } from "@/lib/session";
import { assertTrustedRequest } from "@/lib/security";

const updateSchema = z.object({ connectionMode: z.enum(["websocket", "webhook"]) });

export async function PATCH(request: Request, context: { params: Promise<{ botId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "接入方式不合法" }, { status: 400 });
  try {
    const botId = (await context.params).botId;
    getBotRow(user, botId);
    gatewayManager.disconnect(botId, true, true);
    return NextResponse.json({ bot: updateBotConnectionMode(user, botId, parsed.data.connectionMode) });
  } catch {
    return NextResponse.json({ message: "机器人不存在或无权操作" }, { status: 404 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ botId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  try {
    const botId = (await context.params).botId;
    getBotRow(user, botId);
    gatewayManager.disconnect(botId);
    deleteBot(user, botId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ message: "机器人不存在或无权操作" }, { status: 404 });
  }
}
