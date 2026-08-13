import "server-only";
import { createHash } from "node:crypto";
import { getDatabase } from "@/lib/database";

export class RateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("RATE_LIMITED");
    this.name = "RateLimitError";
  }
}

function requestAddress(request: Request) {
  if (process.env.TRUST_PROXY === "true") {
    return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")?.trim()
      || "unknown";
  }
  return "direct";
}

export function rateLimitKey(request: Request, action: string, subject = "") {
  return createHash("sha256")
    .update([action, requestAddress(request), subject.trim().toLowerCase()].join(":"))
    .digest("hex");
}

export function consumeRateLimit(bucketKey: string, limit: number, windowMs: number) {
  const database = getDatabase();
  const now = Date.now();
  const expiresAt = now + windowMs;

  const result = database.transaction(() => {
    database.prepare("DELETE FROM rate_limit_buckets WHERE expires_at <= ?").run(now);
    const current = database.prepare("SELECT attempts, expires_at FROM rate_limit_buckets WHERE bucket_key = ?").get(bucketKey) as { attempts: number; expires_at: number } | undefined;
    if (!current) {
      database.prepare("INSERT INTO rate_limit_buckets (bucket_key, attempts, window_started_at, expires_at) VALUES (?, 1, ?, ?)").run(bucketKey, now, expiresAt);
      return null;
    }
    if (current.attempts >= limit) return Math.max(1, Math.ceil((current.expires_at - now) / 1000));
    database.prepare("UPDATE rate_limit_buckets SET attempts = attempts + 1 WHERE bucket_key = ?").run(bucketKey);
    return null;
  })();

  if (result !== null) throw new RateLimitError(result);
}

export function assertTrustedRequest(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new Error("UNTRUSTED_ORIGIN");
  const origin = request.headers.get("origin");
  if (!origin) return;
  const originUrl = new URL(origin);
  const requestUrl = new URL(request.url);
  const forwardedHost = process.env.TRUST_PROXY === "true" ? request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() : null;
  const forwardedProtocol = process.env.TRUST_PROXY === "true" ? request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() : null;
  const requestHost = forwardedHost || request.headers.get("host") || requestUrl.host;
  const requestProtocol = forwardedProtocol ? `${forwardedProtocol}:` : requestUrl.protocol;
  if (originUrl.host !== requestHost || originUrl.protocol !== requestProtocol) throw new Error("UNTRUSTED_ORIGIN");
}
