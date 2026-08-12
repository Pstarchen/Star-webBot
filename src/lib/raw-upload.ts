import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const RAW_UPLOAD_MAX_BYTES = 200 * 1024 * 1024 + 1024 * 1024;

export function validateMultipartContentType(value: string) {
  if (!/^multipart\/form-data\s*;[^\r\n]*boundary=[^\r\n;]+/i.test(value)) throw new Error("MULTIPART_CONTENT_TYPE_INVALID");
  return value;
}

export function limitedRequestBody(body: ReadableStream<Uint8Array>, limit = RAW_UPLOAD_MAX_BYTES) {
  let received = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > limit) throw new Error("MULTIPART_BODY_TOO_LARGE");
      controller.enqueue(chunk);
    },
  }));
}

export async function spoolRequestBody(body: ReadableStream<Uint8Array>, limit = RAW_UPLOAD_MAX_BYTES) {
  const tempPath = path.join(os.tmpdir(), `starbot-raw-${randomUUID()}.upload`);
  const hash = createHash("sha256");
  let size = 0;
  const hashingStream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > limit) return callback(new Error("MULTIPART_BODY_TOO_LARGE"));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body as never), hashingStream, createWriteStream(tempPath, { flags: "wx" }));
    return { tempPath, size, sha256: hash.digest("hex") };
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function rawUploadBody(tempPath: string) {
  return createReadStream(tempPath) as unknown as BodyInit;
}

export async function removeRawUpload(tempPath: string | null) {
  if (tempPath) await rm(tempPath, { force: true }).catch(() => undefined);
}
