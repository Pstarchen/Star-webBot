import "server-only";
import { randomUUID } from "node:crypto";
import { startQrConnect, type QrConnectCredentials } from "@tencent-connect/qqbot-connector";
import { decryptSecret, encryptSecret } from "@/lib/crypto-vault";
import { getDatabase, writeAuditLog } from "@/lib/database";
import { createBot } from "@/lib/bot-service";
import { isQQApiError } from "@/lib/qq-api";
import { getSessionUserById } from "@/lib/session";
import type { BotConnectionMode, SessionUser } from "@/types/platform";

const QR_SESSION_TTL_MS = 10 * 60 * 1000;
const QR_SESSION_POLL_MS = 1_000;
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

function safeQrError(error: unknown) {
  if (error instanceof Error && error.message === "BOT_QUOTA_EXCEEDED") return "BOT_QUOTA_EXCEEDED";
  if (error instanceof Error && error.message === "QQ_BOT_PROFILE_INVALID") return "QQ_BOT_PROFILE_INVALID";
  if (error instanceof Error && error.message.includes("UNIQUE")) return "BOT_DUPLICATE";
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
  try {
    const bot = await createBot(user, {
      appId: credential.appId,
      clientSecret: credential.appSecret,
      environment: row.environment,
      connectionMode: row.connection_mode,
    });
    if (terminalUpdate(sessionId, "completed", { botId: bot.id })) {
      writeAuditLog(user.id, "bot.qr_connect.complete", "bot", bot.id, { sessionId, appId: bot.appId });
    }
  } catch (error) {
    if (isQQApiError(error)) {
      const body = error.responseBody && typeof error.responseBody === "object" ? error.responseBody as Record<string, unknown> : {};
      console.error("[qq-bot-qr] QQ API rejected scanned credentials", {
        sessionId,
        status: error.status,
        traceId: error.traceId,
        platformCode: body.err_code ?? body.code ?? body.retcode,
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
  const controller = new AbortController();
  const stopSdk = startQrConnect({
    onSuccess(credentials) {
      void importCredentials(sessionId, credentials);
    },
    onFailure(error) {
      const row = database().prepare("SELECT status FROM qq_bot_qr_sessions WHERE id = ?").get(sessionId) as { status: QrSessionStatus } | undefined;
      if (row && activeStatuses.includes(row.status as (typeof activeStatuses)[number])) {
        failSession(sessionId, error.message === "已取消" ? "QQ_BOT_QR_CANCELLED" : "QQ_BOT_QR_CONNECT_FAILED");
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
  }, { displayQrCodeToConsole: false, source: "StarBot", signal: controller.signal });

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
