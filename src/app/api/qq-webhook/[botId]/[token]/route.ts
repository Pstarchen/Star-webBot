import { NextResponse } from "next/server";
import { handleQQWebhook } from "@/lib/qq-webhook";
import { RateLimitError, consumeRateLimit } from "@/lib/security";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ botId: string; token: string }> }) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 2 * 1024 * 1024) return NextResponse.json({ message: "请求体过大" }, { status: 413 });
  const { botId, token } = await context.params;
  const appId = request.headers.get("x-bot-appid") || "";
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > 2 * 1024 * 1024) return NextResponse.json({ message: "请求体过大" }, { status: 413 });
  try {
    consumeRateLimit(`qq-webhook:${botId}`, 600, 60_000);
    const result = await handleQQWebhook(botId, token, appId, rawBody, request.headers);
    return NextResponse.json(result.challenge || {});
  } catch (error) {
    if (error instanceof RateLimitError) return NextResponse.json({ message: "回调请求过于频繁" }, { status: 429 });
    if (error instanceof Error && error.message === "BOT_NOT_FOUND") return NextResponse.json({ message: "机器人不存在" }, { status: 404 });
    if (error instanceof Error && error.message === "QQ_WEBHOOK_MODE_REQUIRED") return NextResponse.json({ message: "机器人未启用 Webhook 接入" }, { status: 409 });
    if (error instanceof Error && ["QQ_WEBHOOK_TOKEN_INVALID", "QQ_WEBHOOK_APP_ID_MISMATCH"].includes(error.message)) return NextResponse.json({ message: "回调地址或 AppID 不匹配" }, { status: 403 });
    if (error instanceof Error && error.message === "QQ_WEBHOOK_SIGNATURE_INVALID") return NextResponse.json({ message: "回调签名无效" }, { status: 401 });
    return NextResponse.json({ message: "回调请求无效" }, { status: 400 });
  }
}
