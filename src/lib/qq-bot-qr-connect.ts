import "server-only";
import { createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/crypto-vault";
import { getDatabase, writeAuditLog } from "@/lib/database";
import { createBot, deleteBotInternal, setBotAutoConnect } from "@/lib/bot-service";
import { gatewayManager } from "@/lib/gateway-manager";
import { formatQQApiError, isQQApiError, qqApiErrorDetails } from "@/lib/qq-api";
import { getSessionUserById } from "@/lib/session";
import type { BotConnectionMode, SessionUser } from "@/types/platform";

const QR_SESSION_TTL_MS = 10 * 60 * 1000;
const QR_SESSION_POLL_MS = 1_000;
const QR_CONNECT_POLL_MS = 2_000;
const QR_REQUEST_TIMEOUT_MS = 10_000;
const QR_GATEWAY_RETRY_MS = 1_000;
const QR_GATEWAY_CONNECT_WAIT_MS = 5_000;
const QR_CONNECT_BASE = "https://q.qq.com";
const QR_API_HOSTS = {
  production: "q.qq.com",
  sandbox: "test.q.qq.com",
} as const;
const QR_CONNECT_SOURCE = "";
const activeStatuses = ["pending", "scanning"] as const;

type QrSessionStatus = "pending" | "scanning" | "completed" | "expired" | "cancelled" | "failed";

type QrSessionRow = {
  id: string;
  user_id: string;
  environment: "production" | "sandbox";
  connection_mode: BotConnectionMode;
  status: QrSessionStatus;
  qr_url_cipher: string | null;
  qr_revision: number;
  bot_id: string | null;
  error_code: string | null;
  expires_at: number;
  created_at: string;
  updated_at: string;
};

type Runtime = {
  stop: () => void;
  pollTimer: NodeJS.Timeout;
  expiryTimer: NodeJS.Timeout;
};

type RuntimeState = typeof globalThis & { __starbotQrConnectRuntimes?: Map<string, Runtime> };

type QrConnectCredentials = { appId: string; appSecret: string };

type QrApiBody = {
  retcode?: number | string;
  msg?: string;
  message?: string;
  data?: Record<string, unknown>;
};

type QrBindTask = { taskId: string; key: string };

class QrConnectorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
    public readonly retcode?: string,
    public readonly traceId?: string | null,
  ) {
    super(message);
    this.name = "QrConnectorError";
  }
}

function qrTraceId(response: Response, body: unknown) {
  const headerTraceId = response.headers.get("X-Tps-trace-ID") || response.headers.get("x-tps-trace-id");
  if (headerTraceId) return headerTraceId;
  if (body && typeof body === "object" && "trace_id" in body && typeof body.trace_id === "string") return body.trace_id;
  return null;
}

function abortError() {
  return new DOMException("Aborted", "AbortError");
}

function waitFor(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(abortError());
    }, { once: true });
  });
}

function qrApiBase(environment: QrSessionRow["environment"]) {
  return `https://${QR_API_HOSTS[environment]}`;
}

async function qrRequest(environment: QrSessionRow["environment"], path: string, payload: Record<string, unknown>, signal: AbortSignal) {
  const requestController = new AbortController();
  const timeout = setTimeout(() => requestController.abort(), QR_REQUEST_TIMEOUT_MS);
  const abortRequest = () => requestController.abort();
  signal.addEventListener("abort", abortRequest, { once: true });
  try {
    const body = JSON.stringify(payload);
    let response: Response;
    try {
      response = await fetch(`${qrApiBase(environment)}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body,
        signal: requestController.signal,
        cache: "no-store",
      });
    } catch {
      if (signal.aborted) throw abortError();
      if (requestController.signal.aborted) throw new QrConnectorError("QQ 扫码服务请求超时", "QQ_BOT_QR_TIMEOUT");
      throw new QrConnectorError("QQ 扫码服务网络请求失败", "QQ_BOT_QR_NETWORK_FAILED");
    }

    let responseText: string;
    try {
      responseText = await response.text();
    } catch {
      if (signal.aborted) throw abortError();
      if (requestController.signal.aborted) throw new QrConnectorError("QQ 扫码服务请求超时", "QQ_BOT_QR_TIMEOUT");
      throw new QrConnectorError("QQ 扫码服务响应读取失败", "QQ_BOT_QR_NETWORK_FAILED");
    }
    let parsed: unknown = null;
    if (responseText) {
      try { parsed = JSON.parse(responseText); } catch { parsed = null; }
    }
    const traceId = qrTraceId(response, parsed);
    if (!response.ok) {
      throw new QrConnectorError(
        `QQ 扫码服务返回 HTTP ${response.status}`,
        `QQ_BOT_QR_HTTP_${response.status}`,
        response.status,
        undefined,
        traceId,
      );
    }
    if (!parsed || typeof parsed !== "object") {
      throw new QrConnectorError("QQ 扫码服务响应格式无效", "QQ_BOT_QR_PROTOCOL_INVALID", response.status, undefined, traceId);
    }
    return { body: parsed as QrApiBody, traceId };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abortRequest);
  }
}

function retcodeValue(body: QrApiBody) {
  if (typeof body.retcode !== "number" && typeof body.retcode !== "string") return null;
  return String(body.retcode);
}

function assertQrSuccess(body: QrApiBody, traceId: string | null | undefined) {
  const retcode = retcodeValue(body);
  if (retcode === null) throw new QrConnectorError("QQ 扫码服务响应缺少 retcode", "QQ_BOT_QR_PROTOCOL_INVALID", undefined, undefined, traceId);
  if (retcode !== "0") {
    throw new QrConnectorError(
      body.msg || body.message || `QQ 扫码服务错误 ${retcode}`,
      `QQ_BOT_QR_API_${retcode.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32)}`,
      undefined,
      retcode,
      traceId,
    );
  }
}

async function createBindTask(environment: QrSessionRow["environment"], signal: AbortSignal): Promise<QrBindTask> {
  const key = randomBytes(32).toString("base64");
  const response = await qrRequest(environment, "/lite/create_bind_task", { key }, signal);
  assertQrSuccess(response.body, response.traceId);
  const taskId = response.body.data?.task_id;
  if (typeof taskId !== "string" || !taskId.trim()) {
    throw new QrConnectorError("QQ 扫码服务未返回 task_id", "QQ_BOT_QR_PROTOCOL_INVALID", undefined, undefined, response.traceId);
  }
  return { taskId: taskId.trim(), key };
}

function bindStatus(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (/^\d+$/.test(normalized)) return Number(normalized);
    if (normalized === "none") return 0;
    if (normalized === "pending" || normalized === "scanning") return 1;
    if (normalized === "completed" || normalized === "success" || normalized === "done") return 2;
    if (normalized === "expired" || normalized === "expire") return 3;
  }
  return null;
}

function decryptBindSecret(encryptedBase64: string, keyBase64: string) {
  try {
    const encrypted = Buffer.from(encryptedBase64, "base64");
    const key = Buffer.from(keyBase64, "base64");
    if (key.length !== 32 || encrypted.length < 12 + 16) throw new Error("invalid encrypted secret");
    const decipher = createDecipheriv("aes-256-gcm", key, encrypted.subarray(0, 12));
    decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
    return Buffer.concat([decipher.update(encrypted.subarray(12, encrypted.length - 16)), decipher.final()]).toString("utf8");
  } catch {
    throw new QrConnectorError("QQ 扫码服务返回的凭据无法解密", "QQ_BOT_QR_DECRYPT_FAILED");
  }
}

async function pollBindResult(environment: QrSessionRow["environment"], taskId: string, key: string, signal: AbortSignal) {
  const response = await qrRequest(environment, "/lite/poll_bind_result", { task_id: taskId }, signal);
  assertQrSuccess(response.body, response.traceId);
  const data = response.body.data;
  if (!data) throw new QrConnectorError("QQ 扫码服务响应缺少绑定结果", "QQ_BOT_QR_PROTOCOL_INVALID", undefined, undefined, response.traceId);
  const status = bindStatus(data.status);
  if (status === null) throw new QrConnectorError("QQ 扫码服务返回未知绑定状态", "QQ_BOT_QR_PROTOCOL_INVALID", undefined, undefined, response.traceId);
  if (status === 2) {
    // QQ has returned bot_appid as both a JSON string and a number. Match the
    // official connector, which normalizes the value before validating it.
    const appId = typeof data.bot_appid === "string" || typeof data.bot_appid === "number"
      ? String(data.bot_appid).trim()
      : "";
    const encryptedSecret = typeof data.bot_encrypt_secret === "string" ? data.bot_encrypt_secret : "";
    if (!appId || !encryptedSecret) throw new QrConnectorError("QQ 扫码服务未返回完整凭据", "QQ_BOT_QR_CREDENTIALS_INVALID", undefined, undefined, response.traceId);
    return { status, credentials: { appId, appSecret: decryptBindSecret(encryptedSecret, key) } satisfies QrConnectCredentials };
  }
  return { status, credentials: null };
}

function buildQrUrl(taskId: string) {
  return `${QR_CONNECT_BASE}/qqbot/openclaw/connect.html?task_id=${encodeURIComponent(taskId)}&source=${encodeURIComponent(QR_CONNECT_SOURCE)}&_wv=2`;
}

type QrConnectorCallbacks = {
  onSuccess: (credentials: QrConnectCredentials[]) => void;
  onFailure: (error: Error) => void;
  onQrDisplayed: (url: string) => void;
  onQrExpired: () => void;
};

function startQrConnector(environment: QrSessionRow["environment"], callbacks: QrConnectorCallbacks, signal: AbortSignal) {
  let stopped = false;
  const run = async () => {
    while (!signal.aborted) {
      const task = await createBindTask(environment, signal);
      callbacks.onQrDisplayed(buildQrUrl(task.taskId));
      let pollFailureCount = 0;
      while (!signal.aborted) {
        try {
          const result = await pollBindResult(environment, task.taskId, task.key, signal);
          pollFailureCount = 0;
          if (result.status === 2 && result.credentials) {
            callbacks.onSuccess([result.credentials]);
            return;
          }
          if (result.status === 3) {
            callbacks.onQrExpired();
            break;
          }
        } catch (error) {
          if (signal.aborted) throw abortError();
          const code = error instanceof QrConnectorError ? error.code : "";
          // The QQ connector treats errors from poll_bind_result as transient
          // while the phone is completing the handoff. Only malformed scanned
          // credentials are terminal; API/network responses must not turn a
          // still-valid QR session into a false failure.
          if (code === "QQ_BOT_QR_DECRYPT_FAILED" || code === "QQ_BOT_QR_CREDENTIALS_INVALID") throw error;
          pollFailureCount += 1;
          const retryDelay = code === "QQ_BOT_QR_API_30012"
            ? QR_CONNECT_POLL_MS + 1_000
            : QR_CONNECT_POLL_MS * Math.min(pollFailureCount, 3);
          if (code && pollFailureCount === 1) {
            console.warn("[qq-bot-qr] transient poll failure; continuing QR session", {
              code,
              message: (error instanceof Error ? error.message : String(error)).slice(0, 240),
              retcode: error instanceof QrConnectorError ? error.retcode : undefined,
              status: error instanceof QrConnectorError ? error.status : undefined,
              traceId: error instanceof QrConnectorError ? error.traceId : undefined,
            });
          }
          await waitFor(retryDelay, signal);
          continue;
        }
        await waitFor(QR_CONNECT_POLL_MS, signal);
      }
    }
    throw abortError();
  };
  void run().catch((error: unknown) => {
    if (stopped && error instanceof DOMException && error.name === "AbortError") {
      callbacks.onFailure(new Error("已取消"));
      return;
    }
    callbacks.onFailure(error instanceof Error ? error : new Error(String(error)));
  });
  return () => {
    stopped = true;
  };
}

function runtimes() {
  const state = globalThis as RuntimeState;
  state.__starbotQrConnectRuntimes ||= new Map();
  return state.__starbotQrConnectRuntimes;
}

function now() {
  return Date.now();
}

function database() {
  return getDatabase();
}

function rowForUser(userId: string, sessionId: string) {
  return database().prepare("SELECT * FROM qq_bot_qr_sessions WHERE id = ? AND user_id = ?").get(sessionId, userId) as QrSessionRow | undefined;
}

function cleanup(sessionId: string) {
  const runtime = runtimes().get(sessionId);
  if (!runtime) return;
  clearInterval(runtime.pollTimer);
  clearTimeout(runtime.expiryTimer);
  runtimes().delete(sessionId);
}

function publicSession(row: QrSessionRow) {
  return {
    id: row.id,
    status: row.status,
    environment: row.environment,
    connectionMode: row.connection_mode,
    qrRevision: row.qr_revision,
    expiresAt: row.expires_at,
    botId: row.bot_id,
    errorCode: row.error_code,
  };
}

function activeRow(row: QrSessionRow | undefined): row is QrSessionRow {
  return Boolean(row && activeStatuses.includes(row.status as (typeof activeStatuses)[number]));
}

function terminalUpdate(sessionId: string, status: Exclude<QrSessionStatus, "pending" | "scanning">, extra: { botId?: string | null; errorCode?: string | null } = {}) {
  const updated = database().prepare(`
    UPDATE qq_bot_qr_sessions
    SET status = ?, bot_id = COALESCE(?, bot_id), error_code = ?, qr_url_cipher = NULL, updated_at = ?
    WHERE id = ? AND status IN ('pending', 'scanning')
  `).run(status, extra.botId ?? null, extra.errorCode ?? null, new Date().toISOString(), sessionId);
  if (updated.changes === 1) cleanup(sessionId);
  return updated.changes === 1;
}

function expireSession(sessionId: string) {
  terminalUpdate(sessionId, "expired", { errorCode: "QQ_BOT_QR_EXPIRED" });
}

function failSession(sessionId: string, errorCode: string) {
  terminalUpdate(sessionId, "failed", { errorCode });
}

function waitWithoutAbort(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function retryableGatewayHandoffError(error: unknown) {
  if (error instanceof Error && ["GATEWAY_ALREADY_OWNED", "QQ_BOT_QR_GATEWAY_NOT_ONLINE"].includes(error.message)) return true;
  if (isQQApiError(error)) {
    if (error.message === "QQ 凭据验证失败，请检查 AppID 和 Client Secret") return false;
    return [400, 401, 404, 408, 409, 425, 429].includes(error.status) || error.status >= 500;
  }
  return error instanceof TypeError || (error instanceof Error && /fetch|network|timeout|temporar/i.test(error.message));
}

async function connectQrGateway(botId: string, expiresAt: number) {
  // QQ's mobile connect page keeps waiting while the newly bound bot's
  // gateway metadata propagates. Keep the handoff alive for the remainder of
  // the QR session instead of failing after a shorter local timeout.
  const deadline = expiresAt;
  let lastError: unknown;
  while (now() < deadline) {
    try {
      const status = await gatewayManager.connectPending(botId);
      const remaining = Math.max(250, deadline - now());
      if (status.connected || await gatewayManager.waitForConnected(botId, Math.min(QR_GATEWAY_CONNECT_WAIT_MS, remaining))) return;
      lastError = new Error("QQ_BOT_QR_GATEWAY_NOT_ONLINE");
    } catch (error) {
      lastError = error;
      if (!retryableGatewayHandoffError(error)) throw error;
    }
    gatewayManager.disconnect(botId, false, false);
    await waitWithoutAbort(Math.min(QR_GATEWAY_RETRY_MS, Math.max(0, deadline - now())));
  }
  if (lastError instanceof Error && lastError.message !== "QQ_BOT_QR_GATEWAY_NOT_ONLINE") {
    console.warn("[qq-bot-qr] Gateway handoff timed out", {
      botId,
      error: isQQApiError(lastError) ? formatQQApiError(lastError) : lastError.message,
    });
  }
  throw new Error("QQ_BOT_QR_GATEWAY_NOT_ONLINE");
}

function safeQrError(error: unknown) {
  if (error instanceof Error && error.message === "BOT_QUOTA_EXCEEDED") return "BOT_QUOTA_EXCEEDED";
  if (error instanceof Error && error.message === "QQ_BOT_PROFILE_INVALID") return "QQ_BOT_PROFILE_INVALID";
  if (error instanceof Error && error.message === "QQ_BOT_QR_GATEWAY_NOT_ONLINE") return "QQ_BOT_QR_GATEWAY_NOT_ONLINE";
  if (error instanceof Error) {
    const errorCode = "code" in error && typeof error.code === "string" ? error.code : "";
    if (errorCode.startsWith("QQ_BOT_QR_")) return errorCode;
    if (errorCode === "ER_DUP_ENTRY" || /UNIQUE constraint failed|Duplicate entry|bots_user_app_idx/i.test(error.message)) {
      return "BOT_DUPLICATE";
    }
  }
  if (isQQApiError(error)) {
    const body = error.responseBody && typeof error.responseBody === "object" ? error.responseBody as Record<string, unknown> : {};
    const platformCode = body.err_code ?? body.code ?? body.retcode;
    if (typeof platformCode === "string" || typeof platformCode === "number") {
      const normalized = String(platformCode).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
      if (normalized) return `QQ_BOT_API_${normalized}`;
    }
    return `QQ_BOT_API_HTTP_${error.status}`;
  }
  return "QQ_BOT_QR_IMPORT_FAILED";
}

async function importCredentials(sessionId: string, credentials: QrConnectCredentials[]) {
  const row = database().prepare("SELECT * FROM qq_bot_qr_sessions WHERE id = ?").get(sessionId) as QrSessionRow | undefined;
  if (!activeRow(row)) return;
  if (credentials.length !== 1) {
    failSession(sessionId, "QQ_BOT_QR_MULTIPLE_RESULTS");
    return;
  }
  const credential = credentials[0];
  if (!credential.appId?.trim() || !credential.appSecret?.trim()) {
    failSession(sessionId, "QQ_BOT_QR_CREDENTIALS_INVALID");
    return;
  }
  const user = getSessionUserById(row.user_id);
  if (!user) {
    failSession(sessionId, "SESSION_USER_INVALID");
    return;
  }
  let botId: string | null = null;
  try {
    const bot = await createBot(user, {
      appId: credential.appId,
      clientSecret: credential.appSecret,
      environment: row.environment,
      connectionMode: row.connection_mode,
    }, {
      allowProfileFallback: true,
      skipProfileLookup: row.connection_mode === "websocket",
    });
    botId = bot.id;
    if (row.connection_mode === "websocket") {
      // QQ's mobile connect page waits for online_state after SelectBindBot.
      // Newly bound bots can return transient API errors while their gateway
      // metadata propagates, so keep trying inside the mobile handoff window.
      await connectQrGateway(bot.id, row.expires_at);
      setBotAutoConnect(bot.id, true);
      gatewayManager.promotePending(bot.id);
    }
    if (!terminalUpdate(sessionId, "completed", { botId: bot.id })) throw new Error("QQ_BOT_QR_SESSION_CLOSED");
    writeAuditLog(user.id, "bot.qr_connect.complete", "bot", bot.id, { sessionId, appId: bot.appId });
  } catch (error) {
    if (botId) {
      gatewayManager.disconnect(botId, true, false);
      deleteBotInternal(botId);
      writeAuditLog(user.id, "bot.qr_connect.rollback", "bot", botId, { sessionId, reason: safeQrError(error) });
    }
    if (isQQApiError(error)) {
      const details = qqApiErrorDetails(error);
      const body = error.responseBody && typeof error.responseBody === "object" ? error.responseBody as Record<string, unknown> : {};
      console.error("[qq-bot-qr] QQ API rejected scanned credentials", {
        sessionId,
        status: error.status,
        traceId: error.traceId,
        platformCode: details.code || body.err_code || body.code || body.retcode,
        message: details.message || (typeof body.message === "string" ? body.message.slice(0, 240) : undefined),
      });
    } else {
      console.error("[qq-bot-qr] scanned credential import failed", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    failSession(sessionId, safeQrError(error));
  }
}

function startSdk(sessionId: string) {
  const session = database().prepare("SELECT environment FROM qq_bot_qr_sessions WHERE id = ?").get(sessionId) as Pick<QrSessionRow, "environment"> | undefined;
  if (!session) throw new Error("QQ_BOT_QR_SESSION_NOT_FOUND");
  const controller = new AbortController();
  const stopSdk = startQrConnector(session.environment, {
    onSuccess(credentials) {
      void importCredentials(sessionId, credentials);
    },
    onFailure(error) {
      const row = database().prepare("SELECT status FROM qq_bot_qr_sessions WHERE id = ?").get(sessionId) as { status: QrSessionStatus } | undefined;
      if (row && activeStatuses.includes(row.status as (typeof activeStatuses)[number])) {
        const cancelled = error.message === "已取消";
        console.error("[qq-bot-qr] connector failed", {
          sessionId,
          error: error.message.slice(0, 240),
          code: "code" in error && typeof error.code === "string" ? error.code : undefined,
          status: error instanceof QrConnectorError ? error.status : undefined,
          retcode: error instanceof QrConnectorError ? error.retcode : undefined,
          traceId: error instanceof QrConnectorError ? error.traceId : undefined,
        });
        failSession(sessionId, cancelled ? "QQ_BOT_QR_CANCELLED" : safeQrError(error));
      }
    },
    onQrDisplayed(url) {
      const row = database().prepare("SELECT status, expires_at FROM qq_bot_qr_sessions WHERE id = ?").get(sessionId) as Pick<QrSessionRow, "status" | "expires_at"> | undefined;
      if (!row || !activeStatuses.includes(row.status as (typeof activeStatuses)[number]) || row.expires_at <= now()) {
        controller.abort();
        return;
      }
      database().prepare(`
        UPDATE qq_bot_qr_sessions
        SET status = 'scanning', qr_url_cipher = ?, qr_revision = qr_revision + 1, updated_at = ?
        WHERE id = ? AND status IN ('pending', 'scanning') AND expires_at > ?
      `).run(encryptSecret(url), new Date().toISOString(), sessionId, now());
    },
    onQrExpired() {
      database().prepare("UPDATE qq_bot_qr_sessions SET qr_url_cipher = NULL, updated_at = ? WHERE id = ? AND status = 'scanning'").run(new Date().toISOString(), sessionId);
    },
  }, controller.signal);

  const pollTimer = setInterval(() => {
    const row = database().prepare("SELECT status, expires_at FROM qq_bot_qr_sessions WHERE id = ?").get(sessionId) as Pick<QrSessionRow, "status" | "expires_at"> | undefined;
    if (!row || row.status === "cancelled" || row.status === "completed" || row.status === "failed") {
      controller.abort();
      stopSdk();
      cleanup(sessionId);
      return;
    }
    if (row.expires_at <= now()) {
      expireSession(sessionId);
      controller.abort();
      stopSdk();
    }
  }, QR_SESSION_POLL_MS);
  pollTimer.unref?.();
  const expiryTimer = setTimeout(() => {
    expireSession(sessionId);
    controller.abort();
    stopSdk();
  }, QR_SESSION_TTL_MS + 100);
  expiryTimer.unref?.();
  runtimes().set(sessionId, { stop: () => { controller.abort(); stopSdk(); cleanup(sessionId); }, pollTimer, expiryTimer });
}

export function startQrSession(user: SessionUser, input: { environment: "production" | "sandbox"; connectionMode: BotConnectionMode }) {
  const db = database();
  const timestamp = now();
  db.prepare("DELETE FROM qq_bot_qr_sessions WHERE expires_at <= ? OR status IN ('completed', 'expired', 'cancelled', 'failed')").run(timestamp - QR_SESSION_TTL_MS);
  const existing = db.prepare("SELECT id FROM qq_bot_qr_sessions WHERE user_id = ? AND status IN ('pending', 'scanning') AND expires_at > ?").get(user.id, timestamp) as { id: string } | undefined;
  if (existing) throw new Error("QQ_BOT_QR_ALREADY_ACTIVE");
  const id = randomUUID();
  const nowIso = new Date().toISOString();
  db.prepare(`
    INSERT INTO qq_bot_qr_sessions
      (id, user_id, environment, connection_mode, status, qr_url_cipher, qr_revision, bot_id, error_code, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', NULL, 0, NULL, NULL, ?, ?, ?)
  `).run(id, user.id, input.environment, input.connectionMode, timestamp + QR_SESSION_TTL_MS, nowIso, nowIso);
  writeAuditLog(user.id, "bot.qr_connect.start", "qr_session", id, { environment: input.environment, connectionMode: input.connectionMode });
  startSdk(id);
  return getQrSession(user, id)!;
}

export function getQrSession(user: SessionUser, sessionId: string) {
  const row = rowForUser(user.id, sessionId);
  if (!row) throw new Error("QQ_BOT_QR_SESSION_NOT_FOUND");
  if (activeRow(row) && row.expires_at <= now()) {
    expireSession(sessionId);
    return publicSession(database().prepare("SELECT * FROM qq_bot_qr_sessions WHERE id = ?").get(sessionId) as QrSessionRow);
  }
  return publicSession(row);
}

export function getQrSessionImage(user: SessionUser, sessionId: string) {
  const row = rowForUser(user.id, sessionId);
  if (!row || !activeRow(row) || row.expires_at <= now() || !row.qr_url_cipher) throw new Error("QQ_BOT_QR_IMAGE_NOT_FOUND");
  return decryptSecret(row.qr_url_cipher);
}

export function cancelQrSession(user: SessionUser, sessionId: string) {
  const row = rowForUser(user.id, sessionId);
  if (!row) throw new Error("QQ_BOT_QR_SESSION_NOT_FOUND");
  if (activeRow(row)) {
    database().prepare(`
      UPDATE qq_bot_qr_sessions
      SET status = 'cancelled', error_code = 'QQ_BOT_QR_CANCELLED', qr_url_cipher = NULL, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'scanning')
    `).run(new Date().toISOString(), sessionId);
    runtimes().get(sessionId)?.stop();
    writeAuditLog(user.id, "bot.qr_connect.cancel", "qr_session", sessionId);
  }
  return getQrSession(user, sessionId);
}

export type { QrSessionStatus };
