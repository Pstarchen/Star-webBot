import { NextResponse } from "next/server";
import { z } from "zod";
import { getBotClient, getMessageReplyContext, recordEvent } from "@/lib/bot-service";
import { isQQApiError } from "@/lib/qq-api";
import { getSession } from "@/lib/session";
import { assertTrustedRequest } from "@/lib/security";

const schema = z.object({
  sendMode: z.enum(["reply", "proactive"]).default("reply"),
  targetType: z.enum(["c2c", "group"]),
  targetOpenid: z.string().trim().min(4).max(160),
  content: z.string().min(1).max(4000),
});

function qqFailure(error: { status: number; traceId: string | null; responseBody: unknown }) {
  const detail = error.responseBody && typeof error.responseBody === "object" ? error.responseBody as Record<string, unknown> : {};
  const code = typeof detail.code === "number" || typeof detail.code === "string" ? String(detail.code) : null;
  const officialMessage = typeof detail.message === "string" ? detail.message : typeof detail.msg === "string" ? detail.msg : "";
  const known: Record<string, string> = {
    "304103": "回复消息已过期，请先在 QQ 中向机器人发送一条新消息。",
    "40034005": "回复消息已过期，请先在 QQ 中向机器人发送一条新消息。",
    "40034024": "回复消息无效或不属于当前机器人，请重新触发一条消息后再试。",
    "40034100": "主动消息发送过于频繁，请稍后重试。",
    "40034101": "机器人不在目标群中，请先将机器人加入该群。",
    "40034105": "机器人没有主动消息权限，请改用“回复最近事件”，或在 QQ 开放平台开通主动消息权限。",
  };
  const message = code && known[code]
    ? known[code]
    : officialMessage
      ? `QQ API 请求失败：${officialMessage}`
      : `QQ API 请求失败，HTTP ${error.status}`;
  return { message, code, traceId: error.traceId, detail: error.responseBody };
}

export async function POST(request: Request, context: { params: Promise<{ botId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "消息参数不合法", issues: parsed.error.issues }, { status: 400 });
  const botId = (await context.params).botId;
  const startedAt = Date.now();
  try {
    const client = getBotClient(user, botId);
    const replyContext = parsed.data.sendMode === "reply"
      ? getMessageReplyContext(user, botId, parsed.data.targetType, parsed.data.targetOpenid)
      : null;
    const payload = {
      content: parsed.data.content,
      msg_type: 0 as const,
      ...(replyContext ? { msg_id: replyContext.msgId, msg_seq: replyContext.msgSeq } : {}),
    };
    const result = parsed.data.targetType === "c2c" ? await client.sendC2CMessage(parsed.data.targetOpenid, payload) : await client.sendGroupMessage(parsed.data.targetOpenid, payload);
    recordEvent(botId, {
      type: "OUTBOUND_MESSAGE",
      scene: parsed.data.targetType === "c2c" ? "单聊" : "群聊",
      latency: Date.now() - startedAt,
      content: parsed.data.content,
      payload: { request: payload, response: result.body, sendMode: parsed.data.sendMode },
      traceId: result.traceId,
    });
    return NextResponse.json({ ...result, sendMode: parsed.data.sendMode, replyContext });
  } catch (error) {
    if (error instanceof Error && error.message === "MESSAGE_REPLY_CONTEXT_NOT_FOUND") {
      return NextResponse.json({ message: parsed.data.targetType === "group" ? "最近 5 分钟内没有找到该群的可回复消息，请先在群内 @ 机器人。" : "最近 60 分钟内没有找到该用户的可回复消息，请先让用户向机器人发送消息。" }, { status: 409 });
    }
    if (error instanceof Error && error.message === "MESSAGE_REPLY_LIMIT_REACHED") {
      return NextResponse.json({ message: "这条消息的可回复次数已用完，请重新向机器人发送一条消息。" }, { status: 409 });
    }
    if (isQQApiError(error)) {
      const failure = qqFailure(error);
      recordEvent(botId, {
        type: "OUTBOUND_MESSAGE_FAILED",
        scene: parsed.data.targetType === "c2c" ? "单聊" : "群聊",
        status: "failed",
        latency: Date.now() - startedAt,
        content: parsed.data.content,
        payload: { response: error.responseBody, sendMode: parsed.data.sendMode },
        traceId: error.traceId,
      });
      return NextResponse.json(failure, { status: 400 });
    }
    return NextResponse.json({ message: "消息发送失败，请检查机器人和目标 OpenID" }, { status: 400 });
  }
}
