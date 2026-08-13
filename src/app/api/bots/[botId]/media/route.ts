import { NextResponse } from "next/server";
import { getBotClient } from "@/lib/bot-service";
import { describeQQMediaApiError, isQQMediaUploadError, parseMediaUploadRequest, QQ_MEDIA_MAX_BYTES, removeParsedMediaUpload, uploadQQMedia, type ParsedMediaUpload } from "@/lib/qq-media";
import { isQQApiError } from "@/lib/qq-api";
import { assertTrustedRequest } from "@/lib/security";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ botId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > QQ_MEDIA_MAX_BYTES + 1024 * 1024) return NextResponse.json({ message: "文件不能超过 200MB" }, { status: 413 });

  let upload: ParsedMediaUpload | null = null;
  try {
    const client = getBotClient(user, (await context.params).botId);
    upload = await parseMediaUploadRequest(request);
    return NextResponse.json(await uploadQQMedia(client, upload));
  } catch (error) {
    if (isQQMediaUploadError(error)) {
      if (isQQApiError(error.mediaCause)) {
        return NextResponse.json(describeQQMediaApiError(error.mediaCause, error.stage), { status: error.mediaCause.status >= 500 ? 502 : 400 });
      }
      if (error.mediaCause instanceof Error && error.mediaCause.message.startsWith("MEDIA_")) {
        return NextResponse.json({ message: "富媒体上传失败", stage: error.stage, detail: error.mediaCause.message }, { status: 400 });
      }
    }
    if (isQQApiError(error)) return NextResponse.json(describeQQMediaApiError(error, null), { status: error.status >= 500 ? 502 : 400 });
    if (error instanceof Error && error.message === "BOT_NOT_FOUND") return NextResponse.json({ message: "机器人不存在" }, { status: 404 });
    if (error instanceof Error && error.message === "MEDIA_FILE_TOO_LARGE") return NextResponse.json({ message: "文件不能超过 200MB" }, { status: 413 });
    if (error instanceof Error && error.message.startsWith("MEDIA_")) return NextResponse.json({ message: "富媒体上传参数或传输失败", detail: error.message }, { status: 400 });
    return NextResponse.json({ message: "富媒体上传失败" }, { status: 500 });
  } finally {
    await removeParsedMediaUpload(upload);
  }
}
