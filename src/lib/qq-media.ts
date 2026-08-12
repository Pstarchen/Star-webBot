import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import type { QQBotApiClient } from "@/lib/qq-api";

export const QQ_MEDIA_MAX_BYTES = 200 * 1024 * 1024;
const QQ_MEDIA_PREFIX_BYTES = 10_002_432;
const MAX_UPLOAD_CONCURRENCY = 4;

export type QQMediaTargetType = "c2c" | "group";
export type QQMediaFileType = 1 | 2 | 3 | 4;

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

type UploadPrepareResponse = {
  upload_id: string;
  block_size: string;
  parts: Array<{ index: number; presigned_url: string; block_size: string }>;
  upload_config?: { concurrency?: number; retry_timeout?: number; retry_delay?: number };
};

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
  const prepare = await client.request<UploadPrepareResponse>(`${root}/upload_prepare`, "POST", {
    file_type: upload.fileType,
    file_size: String(upload.fileSize),
    file_name: upload.fileName,
    md5: upload.md5,
    sha1: upload.sha1,
    md5_10m: upload.md5First10m,
  });
  const body = prepare.body;
  if (!body?.upload_id || !Array.isArray(body.parts) || !body.parts.length) throw new Error("MEDIA_PREPARE_RESPONSE_INVALID");
  const defaultBlockSize = Number(body.block_size);
  if (!Number.isSafeInteger(defaultBlockSize) || defaultBlockSize <= 0) throw new Error("MEDIA_PREPARE_RESPONSE_INVALID");

  const concurrency = Math.max(1, Math.min(MAX_UPLOAD_CONCURRENCY, Number(body.upload_config?.concurrency) || 1));
  const retryDelayMs = Math.max(100, Math.min(10_000, (Number(body.upload_config?.retry_delay) || 1) * 1000));
  const timeoutMs = Math.max(5_000, Math.min(5 * 60_000, (Number(body.upload_config?.retry_timeout) || 300) * 1000));
  const parts = [...body.parts].sort((left, right) => left.index - right.index);
  const expectedPartCount = Math.ceil(upload.fileSize / defaultBlockSize);
  if (parts.length !== expectedPartCount || parts.some((part, index) => part.index !== index)) throw new Error("MEDIA_PREPARE_RESPONSE_INVALID");

  await runWithConcurrency(parts, concurrency, async (part) => {
    if (!Number.isSafeInteger(part.index) || part.index < 0) throw new Error("MEDIA_PREPARE_RESPONSE_INVALID");
    const start = part.index * defaultBlockSize;
    const declaredSize = Number(part.block_size);
    const expectedSize = Math.min(defaultBlockSize, upload.fileSize - start);
    if (!Number.isSafeInteger(declaredSize) || declaredSize !== expectedSize) throw new Error("MEDIA_PREPARE_RESPONSE_INVALID");
    const size = declaredSize;
    const end = Math.min(upload.fileSize - 1, start + size - 1);
    if (start < 0 || start >= upload.fileSize || end < start) throw new Error("MEDIA_PREPARE_RESPONSE_INVALID");
    const partMd5 = await hashFileRange(upload.tempPath, start, end);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await putFileRange(part.presigned_url, upload.tempPath, start, end, timeoutMs);
        await client.request(`${root}/upload_part_finish`, "POST", {
          upload_id: body.upload_id,
          part_index: part.index,
          block_size: String(end - start + 1),
          md5: partMd5,
        });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
      }
    }
    throw lastError;
  });

  return client.request(`${root}/files`, "POST", {
    file_type: upload.fileType,
    srv_send_msg: upload.srvSendMsg,
    file_name: upload.fileName,
    upload_id: body.upload_id,
  });
}

export async function removeParsedMediaUpload(upload: ParsedMediaUpload | null) {
  if (upload?.tempPath) await rm(upload.tempPath, { force: true }).catch(() => undefined);
}
