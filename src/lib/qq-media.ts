import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { lookup as lookupDns } from "node:dns/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { open, rm } from "node:fs/promises";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import { isQQApiError, type QQApiError, type QQBotApiClient } from "@/lib/qq-api";

export const QQ_MEDIA_MAX_BYTES = 200 * 1024 * 1024;
const QQ_MEDIA_PREFIX_BYTES = 10_002_432;
const MAX_UPLOAD_CONCURRENCY = 4;
const REMOTE_MEDIA_MAX_REDIRECTS = 3;
const REMOTE_MEDIA_TIMEOUT_MS = 30_000;

export type QQMediaTargetType = "c2c" | "group";
export type QQMediaFileType = 1 | 2 | 3 | 4;
export type QQMediaUploadStage = "prepare" | "part-upload" | "part-finish" | "merge";

export type ParsedMediaUpload = {
  tempPath: string;
  fileName: string;
  fileSize: number;
  fileType: QQMediaFileType;
  targetType: QQMediaTargetType;
  targetOpenid: string;
  srvSendMsg: boolean;
  md5: string;
  sha1: string;
  md5First10m: string;
};

export type RemoteMediaUploadRequest = {
  url: string;
  headers?: Record<string, string>;
  fileType: QQMediaFileType;
  targetType: QQMediaTargetType;
  targetOpenid: string;
  srvSendMsg: boolean;
};

type UploadPrepareResponse = {
  upload_id: string;
  block_size: string;
  parts: Array<{ index: number; presigned_url: string; block_size: string }>;
  upload_config?: { concurrency?: number; retry_timeout?: number; retry_delay?: number };
};

const QQ_MEDIA_STAGE_LABELS: Record<QQMediaUploadStage, string> = {
  prepare: "预上传准备",
  "part-upload": "分片传输",
  "part-finish": "分片确认",
  merge: "文件合并或发送",
};

export class QQMediaUploadError extends Error {
  readonly status?: number;
  readonly traceId?: string | null;
  readonly responseBody?: unknown;

  constructor(public readonly stage: QQMediaUploadStage, public readonly mediaCause: unknown) {
    super(mediaCause instanceof Error ? mediaCause.message : "MEDIA_UPLOAD_FAILED");
    this.name = "QQMediaUploadError";
    if (isQQApiError(mediaCause)) {
      this.status = mediaCause.status;
      this.traceId = mediaCause.traceId;
      this.responseBody = mediaCause.responseBody;
    }
  }
}

export function isQQMediaUploadError(error: unknown): error is QQMediaUploadError {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Partial<QQMediaUploadError>;
  return candidate.name === "QQMediaUploadError"
    && typeof candidate.stage === "string"
    && Object.hasOwn(QQ_MEDIA_STAGE_LABELS, candidate.stage)
    && "mediaCause" in candidate;
}

function qqErrorCode(error: QQApiError) {
  if (!error.responseBody || typeof error.responseBody !== "object") return null;
  const body = error.responseBody as Record<string, unknown>;
  const nested = body.error && typeof body.error === "object" ? body.error as Record<string, unknown> : null;
  const value = body.code ?? body.retcode ?? body.errcode ?? nested?.code;
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function qqErrorMessage(error: QQApiError) {
  if (!error.responseBody || typeof error.responseBody !== "object") return "";
  const body = error.responseBody as Record<string, unknown>;
  const nested = body.error && typeof body.error === "object" ? body.error as Record<string, unknown> : null;
  const value = body.message ?? body.msg ?? body.error_description ?? nested?.message ?? (typeof body.error === "string" ? body.error : null);
  return typeof value === "string" ? value.trim() : "";
}

export function describeQQMediaApiError(error: QQApiError, stage: QQMediaUploadStage | null) {
  const code = qqErrorCode(error);
  const officialMessage = qqErrorMessage(error);
  const known: Record<string, string> = {
    "850018": "目标群或机器人当前处于禁言状态",
    "850019": "文件格式与所选媒体类型不匹配",
    "850026": "QQ 获取原始文件失败",
    "850027": "QQ 文件处理超时，请稍后重试",
    "850031": "文件超过 QQ 允许的大小限制",
    "10000": "QQ 不支持当前富媒体操作或参数",
    "11255": "目标 OpenID 无效、场景选择错误，或目标不属于当前机器人",
    "40093001": "QQ 富媒体上传通道异常，请稍后重试",
    "40093002": "已超过今日文件发送容量上限",
  };
  return {
    message: `富媒体${stage ? QQ_MEDIA_STAGE_LABELS[stage] : "请求"}失败`,
    code,
    stage,
    detail: (code && known[code]) || officialMessage || `QQ API HTTP ${error.status}`,
    traceId: error.traceId,
  };
}

export function qqMediaApiHttpStatus(error: QQApiError) {
  const code = qqErrorCode(error);
  if (["850018", "850019", "850026", "850031", "10000", "11255", "40093002"].includes(code || "")) return 400;
  return error.status >= 500 ? 502 : 400;
}

function isRetryableMediaError(error: unknown) {
  if (isQQApiError(error)) {
    const code = qqErrorCode(error);
    if (["850018", "850019", "850026", "850031", "10000", "11255", "40093002"].includes(code || "")) return false;
    return ["850027", "40093001"].includes(code || "") || error.status === 408 || error.status === 429 || error.status >= 500;
  }
  if (!(error instanceof Error) || error.message === "MEDIA_PRESIGNED_URL_INVALID") return false;
  const status = Number(error.message.match(/^MEDIA_PART_UPLOAD_FAILED_(\d+)$/)?.[1]);
  return !Number.isFinite(status) || status === 408 || status === 429 || status >= 500;
}

async function runMediaStage<T>(stage: QQMediaUploadStage, worker: () => Promise<T>, retryDelayMs: number, allowRetry = true) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await worker();
    } catch (error) {
      lastError = error;
      if (!allowRetry || attempt >= 2 || !isRetryableMediaError(error)) break;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
    }
  }
  throw new QQMediaUploadError(stage, lastError);
}

function safeFileName(value: string) {
  const normalized = path.basename(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return normalized.slice(0, 180) || "upload.bin";
}

function parseBoolean(value: string | undefined) {
  return value === "true" || value === "1";
}

function assertFileTypeMatchesName(fileType: QQMediaFileType, fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  if (fileType === 1 && ![".png", ".jpg", ".jpeg"].includes(extension)) throw new Error("MEDIA_IMAGE_FORMAT_INVALID");
  if (fileType === 2 && extension !== ".mp4") throw new Error("MEDIA_VIDEO_FORMAT_INVALID");
  if (fileType === 3 && extension !== ".silk") throw new Error("MEDIA_AUDIO_FORMAT_INVALID");
}

async function assertFileTypeMatchesContent(fileType: QQMediaFileType, filePath: string) {
  if (fileType === 4) return;
  const handle = await open(filePath, "r");
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const value = header.subarray(0, bytesRead);
    if (fileType === 1) {
      const isPng = value.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const isJpeg = value.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
      if (!isPng && !isJpeg) throw new Error("MEDIA_IMAGE_CONTENT_INVALID");
    }
    if (fileType === 2 && !value.subarray(4, 8).equals(Buffer.from("ftyp"))) throw new Error("MEDIA_VIDEO_CONTENT_INVALID");
    if (fileType === 3 && !value.subarray(0, 9).equals(Buffer.from("#!SILK_V3"))) throw new Error("MEDIA_AUDIO_CONTENT_INVALID");
  } finally {
    await handle.close();
  }
}

export function mediaUploadInputErrorMessage(code: string) {
  const messages: Record<string, string> = {
    MEDIA_IMAGE_FORMAT_INVALID: "图片仅支持 PNG、JPG 或 JPEG 文件",
    MEDIA_VIDEO_FORMAT_INVALID: "视频仅支持 MP4 文件",
    MEDIA_AUDIO_FORMAT_INVALID: "语音仅支持 SILK 文件",
    MEDIA_IMAGE_CONTENT_INVALID: "所选图片的实际内容不是有效的 PNG 或 JPEG",
    MEDIA_VIDEO_CONTENT_INVALID: "所选视频的实际内容不是 MP4 容器格式",
    MEDIA_AUDIO_CONTENT_INVALID: "所选语音的实际内容不是 SILK 格式",
  };
  return messages[code] || null;
}

export async function parseMediaUploadRequest(request: Request): Promise<ParsedMediaUpload> {
  if (!request.body) throw new Error("MEDIA_BODY_REQUIRED");
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) throw new Error("MEDIA_MULTIPART_REQUIRED");

  const fields = new Map<string, string>();
  let tempPath = "";
  let fileName = "";
  let fileSize = 0;
  let fileTooLarge = false;
  let filePipeline: Promise<void> | undefined;
  const md5 = createHash("md5");
  const sha1 = createHash("sha1");
  const md5First10m = createHash("md5");
  let firstBytesRemaining = QQ_MEDIA_PREFIX_BYTES;

  const parser = Busboy({
    headers: Object.fromEntries(request.headers.entries()),
    limits: { fileSize: QQ_MEDIA_MAX_BYTES, files: 1, fields: 8, fieldSize: 2_048 },
  });

  parser.on("field", (name, value) => fields.set(name, value));
  parser.on("file", (fieldName, stream, info) => {
    if (fieldName !== "file" || filePipeline) {
      stream.resume();
      return;
    }
    fileName = safeFileName(info.filename);
    tempPath = path.join(os.tmpdir(), `starbot-media-${randomUUID()}.upload`);
    stream.on("limit", () => { fileTooLarge = true; });
    const hashingStream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        fileSize += chunk.length;
        md5.update(chunk);
        sha1.update(chunk);
        if (firstBytesRemaining > 0) {
          const prefix = chunk.subarray(0, Math.min(firstBytesRemaining, chunk.length));
          md5First10m.update(prefix);
          firstBytesRemaining -= prefix.length;
        }
        callback(null, chunk);
      },
    });
    filePipeline = pipeline(stream, hashingStream, createWriteStream(tempPath, { flags: "wx" }));
  });

  try {
    await pipeline(Readable.fromWeb(request.body as never), parser);
    await filePipeline;
    if (!tempPath || !fileName || !filePipeline) throw new Error("MEDIA_FILE_REQUIRED");
    if (fileTooLarge || fileSize > QQ_MEDIA_MAX_BYTES) throw new Error("MEDIA_FILE_TOO_LARGE");
    if (fileSize === 0) throw new Error("MEDIA_FILE_EMPTY");
    const fileType = Number(fields.get("fileType"));
    const targetType = fields.get("targetType");
    const targetOpenid = fields.get("targetOpenid")?.trim() || "";
    if (![1, 2, 3, 4].includes(fileType)) throw new Error("MEDIA_FILE_TYPE_INVALID");
    if (targetType !== "c2c" && targetType !== "group") throw new Error("MEDIA_TARGET_TYPE_INVALID");
    if (!targetOpenid || targetOpenid.length > 160) throw new Error("MEDIA_TARGET_INVALID");
    assertFileTypeMatchesName(fileType as QQMediaFileType, fileName);
    await assertFileTypeMatchesContent(fileType as QQMediaFileType, tempPath);
    return {
      tempPath,
      fileName,
      fileSize,
      fileType: fileType as QQMediaFileType,
      targetType,
      targetOpenid,
      srvSendMsg: parseBoolean(fields.get("srvSendMsg")),
      md5: md5.digest("hex"),
      sha1: sha1.digest("hex"),
      md5First10m: md5First10m.digest("hex"),
    };
  } catch (error) {
    if (tempPath) await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function hashFileRange(filePath: string, start: number, end: number) {
  const hash = createHash("md5");
  for await (const chunk of createReadStream(filePath, { start, end })) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function assertPresignedUploadUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("MEDIA_PRESIGNED_URL_INVALID");
  return url.toString();
}

async function putFileRange(url: string, filePath: string, start: number, end: number, timeoutMs: number) {
  const response = await fetch(assertPresignedUploadUrl(url), {
    method: "PUT",
    headers: { "Content-Length": String(end - start + 1) },
    body: createReadStream(filePath, { start, end }) as unknown as BodyInit,
    duplex: "half",
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "error",
    cache: "no-store",
  } as RequestInit & { duplex: "half" });
  if (!response.ok) throw new Error(`MEDIA_PART_UPLOAD_FAILED_${response.status}`);
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

export async function uploadQQMedia(client: QQBotApiClient, upload: ParsedMediaUpload) {
  const encodedTarget = encodeURIComponent(upload.targetOpenid);
  const root = upload.targetType === "group" ? `/v2/groups/${encodedTarget}` : `/v2/users/${encodedTarget}`;
  const prepare = await runMediaStage("prepare", () => client.request<UploadPrepareResponse>(`${root}/upload_prepare`, "POST", {
    file_type: upload.fileType,
    file_size: String(upload.fileSize),
    file_name: upload.fileName,
    md5: upload.md5,
    sha1: upload.sha1,
    md5_10m: upload.md5First10m,
  }), 100);
  const body = prepare.body;
  if (!body?.upload_id || !Array.isArray(body.parts) || !body.parts.length) throw new Error("MEDIA_PREPARE_RESPONSE_INVALID");
  const defaultBlockSize = Number(body.block_size);
  if (!Number.isSafeInteger(defaultBlockSize) || defaultBlockSize <= 0) throw new Error("MEDIA_PREPARE_RESPONSE_INVALID");

  const concurrency = Math.max(1, Math.min(MAX_UPLOAD_CONCURRENCY, Number(body.upload_config?.concurrency) || 1));
  const retryDelayMs = Math.max(100, Math.min(10_000, (Number(body.upload_config?.retry_delay) || 1) * 1000));
  const timeoutMs = Math.max(5_000, Math.min(5 * 60_000, (Number(body.upload_config?.retry_timeout) || 300) * 1000));
  const parts = [...body.parts].sort((left, right) => left.index - right.index);
  const expectedPartCount = Math.ceil(upload.fileSize / defaultBlockSize);
  if (parts.length !== expectedPartCount) throw new Error("MEDIA_PREPARE_RESPONSE_INVALID");
  const firstPartIndex = parts[0]?.index;
  if ((firstPartIndex !== 0 && firstPartIndex !== 1) || parts.some((part, index) => part.index !== firstPartIndex + index)) {
    throw new Error("MEDIA_PREPARE_RESPONSE_INVALID");
  }

  await runWithConcurrency(parts, concurrency, async (part) => {
    if (!Number.isSafeInteger(part.index) || part.index < firstPartIndex) throw new Error("MEDIA_PREPARE_RESPONSE_INVALID");
    const start = (part.index - firstPartIndex) * defaultBlockSize;
    const declaredSize = Number(part.block_size);
    const expectedSize = Math.min(defaultBlockSize, upload.fileSize - start);
    if (!Number.isSafeInteger(declaredSize) || declaredSize !== expectedSize) throw new Error("MEDIA_PREPARE_RESPONSE_INVALID");
    const size = declaredSize;
    const end = Math.min(upload.fileSize - 1, start + size - 1);
    if (start < 0 || start >= upload.fileSize || end < start) throw new Error("MEDIA_PREPARE_RESPONSE_INVALID");
    const partMd5 = await hashFileRange(upload.tempPath, start, end);
    await runMediaStage("part-upload", () => putFileRange(part.presigned_url, upload.tempPath, start, end, timeoutMs), retryDelayMs);
    await runMediaStage("part-finish", () => client.request(`${root}/upload_part_finish`, "POST", {
      upload_id: body.upload_id,
      part_index: part.index,
      block_size: String(end - start + 1),
      md5: partMd5,
    }), retryDelayMs);
  });

  return runMediaStage("merge", () => client.request(`${root}/files`, "POST", {
    file_type: upload.fileType,
    srv_send_msg: upload.srvSendMsg,
    file_name: upload.fileName,
    upload_id: body.upload_id,
  }), retryDelayMs, !upload.srvSendMsg);
}

function blockedRemoteIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0 && c === 113) || a >= 224;
}

function blockedRemoteAddress(address: string) {
  const normalized = address.toLowerCase().split("%")[0];
  if (isIP(normalized) === 4) return blockedRemoteIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  if (normalized.startsWith("::ffff:")) return blockedRemoteIpv4(normalized.slice(7));
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc")
    || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9")
    || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("ff")
    || normalized.startsWith("2001:db8:");
}

function parseRemoteUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("MEDIA_REMOTE_URL_INVALID"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("MEDIA_REMOTE_URL_INVALID");
  if (url.username || url.password) throw new Error("MEDIA_REMOTE_URL_INVALID");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".lan")) {
    throw new Error("MEDIA_REMOTE_PRIVATE_ADDRESS_DENIED");
  }
  return url;
}

async function assertRemotePublic(url: URL) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookupDns(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => blockedRemoteAddress(entry.address))) throw new Error("MEDIA_REMOTE_PRIVATE_ADDRESS_DENIED");
}

function remoteHeaders(input: Record<string, string> | undefined) {
  const result = new Headers();
  const denied = new Set(["connection", "content-length", "host", "proxy-authorization", "transfer-encoding", "upgrade"]);
  const entries = Object.entries(input || {});
  if (entries.length > 20) throw new Error("MEDIA_REMOTE_HEADERS_INVALID");
  for (const [rawName, rawValue] of entries) {
    const name = rawName.trim().toLowerCase();
    const value = String(rawValue);
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]{1,80}$/.test(name) || denied.has(name) || name.startsWith("sec-") || value.length > 2_000) throw new Error("MEDIA_REMOTE_HEADERS_INVALID");
    result.set(name, value);
  }
  return result;
}

async function fetchRemoteMedia(urlValue: string, inputHeaders: Record<string, string> | undefined, signal: AbortSignal) {
  const initial = parseRemoteUrl(urlValue);
  let current = initial;
  const authorizationHeaders = remoteHeaders(inputHeaders);
  for (let redirect = 0; redirect <= REMOTE_MEDIA_MAX_REDIRECTS; redirect += 1) {
    await assertRemotePublic(current);
    const headers = new Headers(authorizationHeaders);
    if (current.origin !== initial.origin) headers.delete("authorization");
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(REMOTE_MEDIA_TIMEOUT_MS)]);
    const response = await fetch(current, { method: "GET", headers, redirect: "manual", signal: requestSignal, cache: "no-store" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirect === REMOTE_MEDIA_MAX_REDIRECTS) throw new Error("MEDIA_REMOTE_REDIRECT_LIMIT");
      const location = response.headers.get("location");
      if (!location) throw new Error("MEDIA_REMOTE_REDIRECT_INVALID");
      current = parseRemoteUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`MEDIA_REMOTE_HTTP_${response.status}`);
    return { response, url: current };
  }
  throw new Error("MEDIA_REMOTE_REDIRECT_LIMIT");
}

function remoteFileName(url: URL, contentType: string, fileType: QQMediaFileType) {
  const content = contentType.split(";", 1)[0].trim().toLowerCase();
  const byType: Record<number, string> = { 1: ".jpg", 2: ".mp4", 3: ".silk", 4: ".bin" };
  const byContent: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "video/mp4": ".mp4",
    "audio/silk": ".silk",
  };
  const extension = path.extname(url.pathname).toLowerCase();
  const selected = byContent[content] || (extension.length <= 8 ? extension : "") || byType[fileType];
  return safeFileName(`remote${selected}`);
}

async function downloadRemoteMedia(urlValue: string, input: RemoteMediaUploadRequest, signal: AbortSignal) {
  const { response, url } = await fetchRemoteMedia(urlValue, input.headers, signal);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > QQ_MEDIA_MAX_BYTES) throw new Error("MEDIA_FILE_TOO_LARGE");
  const fileName = remoteFileName(url, response.headers.get("content-type") || "", input.fileType);
  const tempPath = path.join(os.tmpdir(), `starbot-media-${randomUUID()}.remote`);
  const md5 = createHash("md5");
  const sha1 = createHash("sha1");
  const md5First10m = createHash("md5");
  let fileSize = 0;
  let firstBytesRemaining = QQ_MEDIA_PREFIX_BYTES;
  try {
    const hashingStream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        fileSize += chunk.length;
        if (fileSize > QQ_MEDIA_MAX_BYTES) return callback(new Error("MEDIA_FILE_TOO_LARGE"));
        md5.update(chunk);
        sha1.update(chunk);
        if (firstBytesRemaining > 0) {
          const prefix = chunk.subarray(0, Math.min(firstBytesRemaining, chunk.length));
          md5First10m.update(prefix);
          firstBytesRemaining -= prefix.length;
        }
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body as never), hashingStream, createWriteStream(tempPath, { flags: "wx" }));
    if (!fileSize) throw new Error("MEDIA_FILE_EMPTY");
    await assertFileTypeMatchesContent(input.fileType, tempPath);
    return {
      tempPath,
      fileName,
      fileSize,
      fileType: input.fileType,
      targetType: input.targetType,
      targetOpenid: input.targetOpenid,
      srvSendMsg: input.srvSendMsg,
      md5: md5.digest("hex"),
      sha1: sha1.digest("hex"),
      md5First10m: md5First10m.digest("hex"),
    } satisfies ParsedMediaUpload;
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function uploadQQMediaFromUrl(client: QQBotApiClient, input: RemoteMediaUploadRequest, signal: AbortSignal) {
  const upload = await downloadRemoteMedia(input.url, input, signal);
  try { return await uploadQQMedia(client, upload); }
  finally { await removeParsedMediaUpload(upload); }
}

export async function removeParsedMediaUpload(upload: ParsedMediaUpload | null) {
  if (upload?.tempPath) await rm(upload.tempPath, { force: true }).catch(() => undefined);
}
