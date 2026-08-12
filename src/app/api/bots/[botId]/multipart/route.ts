import { NextResponse } from "next/server";
import { getBotClient } from "@/lib/bot-service";
import { QQApiError, validateQQApiPath } from "@/lib/qq-api";
import { limitedRequestBody, RAW_UPLOAD_MAX_BYTES, validateMultipartContentType } from "@/lib/raw-upload";
import { assertTrustedRequest } from "@/lib/security";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ botId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  if (!request.body) return NextResponse.json({ message: "multipart 请求体不能为空" }, { status: 400 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > RAW_UPLOAD_MAX_BYTES) return NextResponse.json({ message: "multipart 请求不能超过 201MB" }, { status: 413 });
  try {
    const contentType = validateMultipartContentType(request.headers.get("content-type") || "");
    const path = validateQQApiPath(new URL(request.url).searchParams.get("path") || "");
    const client = getBotClient(user, (await context.params).botId);
    return NextResponse.json(await client.requestRaw(path, "POST", limitedRequestBody(request.body), contentType, request.signal));
  } catch (error) {
    if (error instanceof QQApiError) return NextResponse.json({ message: error.message, traceId: error.traceId, detail: error.responseBody }, { status: error.status >= 400 && error.status < 500 ? 400 : 502 });
    if (error instanceof Error && error.message === "BOT_NOT_FOUND") return NextResponse.json({ message: "机器人不存在" }, { status: 404 });
    if (error instanceof Error && error.message === "MULTIPART_BODY_TOO_LARGE") return NextResponse.json({ message: "multipart 请求不能超过 201MB" }, { status: 413 });
    return NextResponse.json({ message: "multipart 请求参数或传输失败" }, { status: 400 });
  }
}
