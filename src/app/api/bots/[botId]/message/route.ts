import { NextResponse } from "next/server";
import { z } from "zod";
import { getBotClient, recordEvent } from "@/lib/bot-service";
import { QQApiError } from "@/lib/qq-api";
import { getSession } from "@/lib/session";
import { assertTrustedRequest } from "@/lib/security";

const schema = z.object({
  targetType: z.enum(["c2c", "group"]),
  targetOpenid: z.string().trim().min(4).max(160),
  content: z.string().min(1).max(4000),
  msgId: z.string().optional(),
  eventId: z.string().optional(),
  msgSeq: z.number().int().nonnegative().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ botId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "消息参数不合法", issues: parsed.error.issues }, { status: 400 });
  const botId = (await context.params).botId;
  try {
    const client = getBotClient(user, botId);
    const payload = { content: parsed.data.content, msg_type: 0 as const, msg_id: parsed.data.msgId, event_id: parsed.data.eventId, msg_seq: parsed.data.msgSeq };
    const startedAt = Date.now();
    const result = parsed.data.targetType === "c2c" ? await client.sendC2CMessage(parsed.data.targetOpenid, payload) : await client.sendGroupMessage(parsed.data.targetOpenid, payload);
    recordEvent(botId, { type: "OUTBOUND_MESSAGE", scene: parsed.data.targetType === "c2c" ? "单聊" : "群聊", latency: Date.now() - startedAt, content: parsed.data.content, payload: result.body, traceId: result.traceId });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof QQApiError) return NextResponse.json({ message: error.message, traceId: error.traceId, detail: error.responseBody }, { status: 400 });
    return NextResponse.json({ message: "消息发送失败，请检查机器人和目标 OpenID" }, { status: 400 });
  }
}
