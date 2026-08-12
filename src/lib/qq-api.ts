import "server-only";
import type { MessagePayload } from "@/types/platform";

const QQ_API_BASE = "https://api.bot.qq.com";
const TOKEN_REFRESH_BUFFER_MS = 60_000;

export type QQBotCredentials = { appId: string; clientSecret: string };

type AccessTokenResponse = { access_token: string; expires_in: number | string };
export type QQGatewayInfo = {
  url: string;
  shards: number;
  session_start_limit: { total: number; remaining: number; reset_after: number; max_concurrency: number };
};
type CachedToken = { value: string; expiresAt: number };

function traceIdFrom(response: Response, body: unknown) {
  const headerTraceId = response.headers.get("X-Tps-trace-ID");
  if (headerTraceId) return headerTraceId;
  if (body && typeof body === "object" && "trace_id" in body && typeof body.trace_id === "string") return body.trace_id;
  return null;
}

export class QQApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly traceId: string | null, public readonly responseBody: unknown) {
    super(message);
    this.name = "QQApiError";
  }
}

export class QQBotApiClient {
  private token?: CachedToken;

  constructor(private readonly credentials: QQBotCredentials) {}

  async getAccessToken() {
    if (this.token && this.token.expiresAt - TOKEN_REFRESH_BUFFER_MS > Date.now()) return this.token.value;
    const response = await fetch(`${QQ_API_BASE}/app/getAppAccessToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.credentials),
      cache: "no-store",
    });
    const body = await response.json().catch(() => null) as AccessTokenResponse | Record<string, unknown> | null;
    if (!response.ok || !body || !("access_token" in body) || typeof body.access_token !== "string") {
      throw new QQApiError("QQ 凭据验证失败，请检查 AppID 和 Client Secret", response.status, traceIdFrom(response, body), body);
    }
    const accessToken = body.access_token;
    const expiresIn = Number(body.expires_in);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error("QQ access token response has an invalid expires_in value");
    this.token = { value: accessToken, expiresAt: Date.now() + expiresIn * 1000 };
    return accessToken;
  }

  async getGatewayInfo() {
    return this.request<QQGatewayInfo>("/gateway/bot", "GET");
  }

  async sendC2CMessage(userOpenid: string, payload: MessagePayload) {
    return this.request(`/v2/users/${encodeURIComponent(userOpenid)}/messages`, "POST", payload);
  }

  async sendGroupMessage(groupOpenid: string, payload: MessagePayload) {
    return this.request(`/v2/groups/${encodeURIComponent(groupOpenid)}/messages`, "POST", payload);
  }

  async request<T = unknown>(path: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", payload?: unknown) {
    const normalizedPath = validateQQApiPath(path);
    const accessToken = await this.getAccessToken();
    const response = await fetch(`${QQ_API_BASE}${normalizedPath}`, {
      method,
      headers: { Authorization: `QQBot ${accessToken}`, "Content-Type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      cache: "no-store",
    });
    return parseQQApiResponse<T>(response);
  }

  async requestRaw<T = unknown>(path: string, method: "POST" | "PUT" | "PATCH", body: BodyInit, contentType: string, signal?: AbortSignal) {
    const normalizedPath = validateQQApiPath(path);
    const accessToken = await this.getAccessToken();
    const response = await fetch(`${QQ_API_BASE}${normalizedPath}`, {
      method,
      headers: { Authorization: `QQBot ${accessToken}`, "Content-Type": contentType },
      body,
      signal,
      cache: "no-store",
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    return parseQQApiResponse<T>(response);
  }
}

async function parseQQApiResponse<T>(response: Response) {
  const responseText = await response.text();
  let body: unknown = null;
  if (responseText) {
    try { body = JSON.parse(responseText); }
    catch { body = responseText; }
  }
  const traceId = traceIdFrom(response, body);
  if (!response.ok) throw new QQApiError("QQ API 请求失败，HTTP " + response.status, response.status, traceId, body);
  return { body: body as T, traceId };
}

export function validateQQApiPath(path: string) {
  const value = path.trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("..") || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("QQ_API_PATH_INVALID");
  }
  const parsed = new URL(value, QQ_API_BASE);
  if (parsed.origin !== QQ_API_BASE || !parsed.pathname.startsWith("/")) throw new Error("QQ_API_PATH_INVALID");
  return parsed.pathname + parsed.search;
}

export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  runtime: "sdk";
  events: string[];
  permissions: string[];
};

export function validatePluginManifest(manifest: PluginManifest) {
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(manifest.id)) throw new Error("Plugin id must use lowercase letters, numbers, and hyphens");
  if (manifest.runtime !== "sdk") throw new Error("Plugin runtime must be sdk");
  return manifest;
}
