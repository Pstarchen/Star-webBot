import { NextResponse } from "next/server";
import { getBotClientInternal } from "@/lib/bot-service";
import { authenticatePluginCanonicalRequest } from "@/lib/plugin-service";
import { isQQApiError, validateQQApiPath } from "@/lib/qq-api";
import { RAW_UPLOAD_MAX_BYTES, rawUploadBody, removeRawUpload, spoolRequestBody, validateMultipartContentType } from "@/lib/raw-upload";
import { RateLimitError, consumeRateLimit, rateLimitKey } from "@/lib/security";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ pluginId: string }> }) {
  const pluginId = (await context.params).pluginId;
  if (!request.body) return NextResponse.json({ message: "multipart 请求体不能为空" }, { status: 400 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > RAW_UPLOAD_MAX_BYTES) return NextResponse.json({ message: "multipart 请求不能超过 201MB" }, { status: 413 });
  let tempPath: string | null = null;
  try {
    consumeRateLimit(rateLimitKey(request, "plugin.multipart", pluginId), 30, 60_000);
    const contentType = validateMultipartContentType(request.headers.get("content-type") || "");
    const path = validateQQApiPath(new URL(request.url).searchParams.get("path") || "");
    const timestamp = request.headers.get("x-starbot-timestamp") || "";
    const nonce = request.headers.get("x-starbot-nonce") || "";
    const signature = request.headers.get("x-starbot-signature") || "";
    const upload = await spoolRequestBody(request.body);
    tempPath = upload.tempPath;
    const canonical = ["POST", path, contentType, upload.sha256].join("\n");
    const authentication = authenticatePluginCanonicalRequest(pluginId, timestamp, nonce, canonical, signature);
    if (!authentication.permissions.includes("qq:api")) return NextResponse.json({ message: "SDK 应用未获得 qq:api 权限" }, { status: 403 });
    return NextResponse.json(await getBotClientInternal(authentication.botId).requestRaw(path, "POST", rawUploadBody(tempPath), contentType));
  } catch (error) {
    if (error instanceof RateLimitError) return NextResponse.json({ message: "SDK 请求过于频繁" }, { status: 429 });
    if (isQQApiError(error)) return NextResponse.json({ message: error.message, traceId: error.traceId, detail: error.responseBody }, { status: 400 });
    if (error instanceof Error && error.message === "PLUGIN_REQUEST_REPLAYED") return NextResponse.json({ message: "SDK 请求已被使用" }, { status: 409 });
    if (error instanceof Error && error.message === "MULTIPART_BODY_TOO_LARGE") return NextResponse.json({ message: "multipart 请求不能超过 201MB" }, { status: 413 });
    return NextResponse.json({ message: "SDK 身份或 multipart 请求无效" }, { status: 401 });
  } finally {
    await removeRawUpload(tempPath);
  }
}
