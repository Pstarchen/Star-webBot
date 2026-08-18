import "server-only";
import { randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/crypto-vault";
import { getDatabase, writeAuditLog } from "@/lib/database";
import { isQQApiError, QQBotApiClient } from "@/lib/qq-api";
import { deriveQQWebhookToken } from "@/lib/qq-webhook-token";
import type { Bot, BotConnectionMode, BotMediaTarget, EventLog, SessionUser } from "@/types/platform";

type BotRow = {
  id: string;
  user_id: string;
  name: string;
  app_id: string;
  client_secret_cipher: string;
  environment: "production" | "sandbox";
  connection_mode: BotConnectionMode;
  intents: number;
  status: Bot["status"];
  gateway_session_id: string | null;
  gateway_sequence: number | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
  auto_connect: number;
};

type ClientCache = typeof globalThis & { __starbotClients?: Map<string, QQBotApiClient> };

export const qqGatewayIntents = {
  directMessage: 1 << 12,
  groupAndC2C: 1 << 25,
  publicGuildMessages: 1 << 30,
} as const;

export const defaultQQGatewayIntents = qqGatewayIntents.directMessage | qqGatewayIntents.groupAndC2C | qqGatewayIntents.publicGuildMessages;

function clientCache() {
  const state = globalThis as ClientCache;
  state.__starbotClients ||= new Map();
  return state.__starbotClients;
}

function ensureAccess(user: SessionUser, row: BotRow | undefined) {
  if (!row || (user.role !== "admin" && row.user_id !== user.id)) throw new Error("BOT_NOT_FOUND");
  return row;
}

function maskAppId(appId: string) {
  if (appId.length <= 8) return appId;
  return appId.slice(0, 5) + "****" + appId.slice(-4);
}

function botMetrics(botId: string) {
  const database = getDatabase();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return database.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN event_type LIKE '%MESSAGE%' THEN 1 ELSE 0 END) AS messages,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successes,
      COALESCE(AVG(latency_ms), 0) AS latency
    FROM event_logs
    WHERE bot_id = ? AND received_at >= ?
  `).get(botId, since) as { total: number; messages: number; successes: number; latency: number };
}

function toBot(row: BotRow): Bot {
  const metrics = botMetrics(row.id);
  const shards = getDatabase().prepare(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) AS online
    FROM gateway_shard_sessions WHERE bot_id = ?
  `).get(row.id) as { total: number; online: number | null };
  return {
    id: row.id,
    name: row.name,
    appId: maskAppId(row.app_id),
    avatar: row.name.slice(0, 1),
    status: row.status,
    environment: row.environment,
    connectionMode: row.connection_mode,
    messageCount: metrics.messages || 0,
    successRate: metrics.total ? Number(((metrics.successes / metrics.total) * 100).toFixed(2)) : 100,
    latency: Math.round(metrics.latency || 0),
    eventsToday: metrics.total || 0,
    lastSeen: row.last_seen_at || "尚未连接",
    tags: [row.environment === "production" ? "正式使用" : "测试使用", row.connection_mode === "websocket" ? "WebSocket" : "Webhook"],
    shardCount: shards.total,
    onlineShards: shards.online || 0,
    webhookPath: `/api/qq-webhook/${row.id}/${deriveQQWebhookToken(row.id, row.client_secret_cipher)}`,
  };
}

export function listBotIdsForUser(userId: string) {
  return (getDatabase().prepare("SELECT id FROM bots WHERE user_id = ?").all(userId) as Array<{ id: string }>).map((row) => row.id);
}

export function listBots(user: SessionUser) {
  const database = getDatabase();
  const rows = database.prepare("SELECT * FROM bots WHERE user_id = ? ORDER BY created_at DESC").all(user.id) as BotRow[];
  return rows.map(toBot);
}

type CreateBotOptions = {
  allowProfileFallback?: boolean;
};

function qrProfileUnavailable(error: unknown) {
  if (!isQQApiError(error)) return false;
  const body = error.responseBody && typeof error.responseBody === "object" ? error.responseBody as Record<string, unknown> : {};
  return String(body.err_code ?? body.code ?? "") === "40011034";
}

export async function createBot(
  user: SessionUser,
  input: { appId: string; clientSecret: string; environment: "production" | "sandbox"; connectionMode: BotConnectionMode },
  options: CreateBotOptions = {},
) {
  const database = getDatabase();
  const usage = database.prepare("SELECT COUNT(*) AS count FROM bots WHERE user_id = ?").get(user.id) as { count: number };
  const currentUser = database.prepare("SELECT bot_quota FROM users WHERE id = ?").get(user.id) as { bot_quota: number } | undefined;
  if (!currentUser || usage.count >= currentUser.bot_quota) throw new Error("BOT_QUOTA_EXCEEDED");

  const normalizedAppId = input.appId.trim();
  const client = new QQBotApiClient({ appId: normalizedAppId, clientSecret: input.clientSecret });
  let name = "";
  let profileFallback = false;
  try {
    const profile = (await client.getBotProfile()).body;
    name = typeof profile?.username === "string" ? profile.username.trim() : "";
    if (!name || typeof profile?.id !== "string" || !profile.id.trim()) throw new Error("QQ_BOT_PROFILE_INVALID");
  } catch (error) {
    if (!options.allowProfileFallback || !qrProfileUnavailable(error)) throw error;
    profileFallback = true;
    name = `QQ 机器人 ${maskAppId(normalizedAppId)}`;
    console.warn("[bot-service] QQ profile unavailable after QR credential validation; using fallback name", {
      appId: maskAppId(normalizedAppId),
      status: isQQApiError(error) ? error.status : undefined,
      traceId: isQQApiError(error) ? error.traceId : undefined,
    });
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO bots (id, user_id, name, app_id, client_secret_cipher, environment, connection_mode, intents, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'offline', ?, ?)
  `).run(id, user.id, name, normalizedAppId, encryptSecret(input.clientSecret), input.environment, input.connectionMode, defaultQQGatewayIntents, now, now);
  clientCache().set(id, client);
  writeAuditLog(user.id, "bot.create", "bot", id, { appId: maskAppId(normalizedAppId), environment: input.environment, connectionMode: input.connectionMode, profileFallback });
  return toBot(database.prepare("SELECT * FROM bots WHERE id = ?").get(id) as BotRow);
}

export function getBotRow(user: SessionUser, botId: string) {
  const row = getDatabase().prepare("SELECT * FROM bots WHERE id = ?").get(botId) as BotRow | undefined;
  return ensureAccess(user, row);
}

export function getBotRowInternal(botId: string) {
  const row = getDatabase().prepare("SELECT * FROM bots WHERE id = ?").get(botId) as BotRow | undefined;
  if (!row) throw new Error("BOT_NOT_FOUND");
  return row;
}

export function getBotClient(user: SessionUser, botId: string) {
  const row = getBotRow(user, botId);
  const cached = clientCache().get(botId);
  if (cached) return cached;
  const client = new QQBotApiClient({ appId: row.app_id, clientSecret: decryptSecret(row.client_secret_cipher) });
  clientCache().set(botId, client);
  return client;
}

export function getBotClientInternal(botId: string) {
  const row = getBotRowInternal(botId);
  const cached = clientCache().get(botId);
  if (cached) return cached;
  const client = new QQBotApiClient({ appId: row.app_id, clientSecret: decryptSecret(row.client_secret_cipher) });
  clientCache().set(botId, client);
  return client;
}

export function getBotGatewayConfig(botId: string) {
  const row = getBotRowInternal(botId);
  if (row.connection_mode !== "websocket") throw new Error("GATEWAY_MODE_REQUIRED");
  return {
    botId: row.id,
    intents: row.intents || defaultQQGatewayIntents,
    sessionId: row.gateway_session_id,
    sequence: row.gateway_sequence,
    client: getBotClientInternal(botId),
  };
}

export function listAutoConnectBotIds() {
  const rows = getDatabase().prepare(`
    SELECT bots.id
    FROM bots
    JOIN users ON users.id = bots.user_id
    WHERE bots.auto_connect = 1 AND bots.connection_mode = 'websocket' AND users.status = 'active'
    ORDER BY bots.created_at ASC
  `).all() as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

export function setBotAutoConnect(botId: string, enabled: boolean) {
  if (enabled && getBotRowInternal(botId).connection_mode !== "websocket") throw new Error("GATEWAY_MODE_REQUIRED");
  getDatabase().prepare("UPDATE bots SET auto_connect = ?, updated_at = ? WHERE id = ?").run(enabled ? 1 : 0, new Date().toISOString(), botId);
}

export function updateBotConnectionMode(user: SessionUser, botId: string, connectionMode: BotConnectionMode) {
  const row = getBotRow(user, botId);
  if (row.connection_mode === connectionMode) return toBot(row);
  const now = new Date().toISOString();
  getDatabase().prepare(`
    UPDATE bots SET connection_mode = ?, auto_connect = 0, status = 'offline',
      gateway_session_id = NULL, gateway_sequence = NULL, last_seen_at = NULL, updated_at = ?
    WHERE id = ?
  `).run(connectionMode, now, botId);
  getDatabase().prepare("DELETE FROM gateway_shard_sessions WHERE bot_id = ?").run(botId);
  writeAuditLog(user.id, "bot.connection_mode.update", "bot", botId, { before: row.connection_mode, after: connectionMode });
  return toBot(getBotRowInternal(botId));
}

export function markBotWebhookActive(botId: string) {
  const row = getBotRowInternal(botId);
  if (row.connection_mode !== "webhook") throw new Error("QQ_WEBHOOK_MODE_REQUIRED");
  const now = new Date().toISOString();
  getDatabase().prepare("UPDATE bots SET status = 'online', last_seen_at = ?, updated_at = ? WHERE id = ?").run(now, now, botId);
}

export function clearBotGatewaySession(botId: string) {
  getDatabase().prepare("UPDATE bots SET gateway_session_id = NULL, gateway_sequence = NULL, updated_at = ? WHERE id = ?").run(new Date().toISOString(), botId);
}

export function deleteBot(user: SessionUser, botId: string) {
  const row = getBotRow(user, botId);
  getDatabase().prepare("DELETE FROM bots WHERE id = ?").run(botId);
  clientCache().delete(botId);
  writeAuditLog(user.id, "bot.delete", "bot", botId, { appId: maskAppId(row.app_id) });
}

export function updateBotConnection(botId: string, input: { status: Bot["status"]; sessionId?: string | null; sequence?: number | null }) {
  getDatabase().prepare(`
    UPDATE bots SET status = ?, gateway_session_id = COALESCE(?, gateway_session_id),
      gateway_sequence = COALESCE(?, gateway_sequence), last_seen_at = ?, updated_at = ? WHERE id = ?
  `).run(input.status, input.sessionId ?? null, input.sequence ?? null, new Date().toISOString(), new Date().toISOString(), botId);
}

export function recordEvent(botId: string, input: { type: string; scene: string; status?: EventLog["status"]; latency?: number; content?: string; payload: unknown; traceId?: string | null }) {
  const id = randomUUID();
  getDatabase().prepare(`
    INSERT INTO event_logs (id, bot_id, event_type, scene, status, latency_ms, content, payload_json, trace_id, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, botId, input.type, input.scene, input.status || "success", input.latency || 0, input.content || "", JSON.stringify(input.payload), input.traceId || null, new Date().toISOString());
  return id;
}

const replyEventTypes = {
  c2c: new Set(["C2C_MESSAGE_CREATE"]),
  group: new Set(["GROUP_AT_MESSAGE_CREATE", "GROUP_MESSAGE_CREATE"]),
} as const;

function mediaTargetFromEvent(eventType: string, payloadJson: string): Pick<BotMediaTarget, "targetType" | "targetOpenid"> | null {
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(payloadJson) as Record<string, unknown>; }
  catch { return null; }
  const data = payload.d && typeof payload.d === "object" ? payload.d as Record<string, unknown> : payload;
  const author = data.author && typeof data.author === "object" ? data.author as Record<string, unknown> : {};
  const targetType = replyEventTypes.group.has(eventType) ? "group" : "c2c";
  const value = targetType === "group" ? data.group_openid : author.user_openid || data.user_openid;
  return typeof value === "string" && value.trim() ? { targetType, targetOpenid: value.trim() } : null;
}

export function listBotMediaTargets(user: SessionUser, botId: string): BotMediaTarget[] {
  getBotRow(user, botId);
  const rows = getDatabase().prepare(`
    SELECT event_type, payload_json, received_at
    FROM event_logs
    WHERE bot_id = ?
      AND event_type IN ('C2C_MESSAGE_CREATE', 'GROUP_AT_MESSAGE_CREATE', 'GROUP_MESSAGE_CREATE')
    ORDER BY received_at DESC
    LIMIT 1000
  `).all(botId) as Array<{ event_type: string; payload_json: string; received_at: string }>;
  const targets = new Map<string, BotMediaTarget>();

  for (const row of rows) {
    const target = mediaTargetFromEvent(row.event_type, row.payload_json);
    if (!target) continue;
    const key = `${target.targetType}:${target.targetOpenid}`;
    if (!targets.has(key)) targets.set(key, { ...target, lastSeenAt: row.received_at });
  }

  return [...targets.values()];
}

export function identifyBotTargetType(user: SessionUser, botId: string, targetOpenid: string) {
  return listBotMediaTargets(user, botId).find((target) => target.targetOpenid === targetOpenid)?.targetType || null;
}

export function getMessageReplyContext(user: SessionUser, botId: string, targetType: "c2c" | "group", targetOpenid: string) {
  getBotRow(user, botId);
  const database = getDatabase();
  const validityMs = targetType === "group" ? 5 * 60_000 : 60 * 60_000;
  const rows = database.prepare(`
    SELECT event_type, payload_json, received_at
    FROM event_logs
    WHERE bot_id = ? AND received_at >= ?
    ORDER BY received_at DESC
    LIMIT 200
  `).all(botId, new Date(Date.now() - validityMs).toISOString()) as Array<{
    event_type: string;
    payload_json: string;
    received_at: string;
  }>;

  for (const row of rows) {
    if (!replyEventTypes[targetType].has(row.event_type)) continue;
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(row.payload_json) as Record<string, unknown>; }
    catch { continue; }
    const data = payload.d && typeof payload.d === "object" ? payload.d as Record<string, unknown> : payload;
    const author = data.author && typeof data.author === "object" ? data.author as Record<string, unknown> : {};
    const eventTarget = targetType === "group"
      ? data.group_openid || data.group_id
      : author.user_openid || author.id || data.user_openid;
    const messageId = typeof data.id === "string" ? data.id : null;
    if (eventTarget !== targetOpenid || !messageId) continue;

    const previousReplies = (database.prepare(`
      SELECT payload_json
      FROM event_logs
      WHERE bot_id = ? AND event_type = 'OUTBOUND_MESSAGE'
    `).all(botId) as Array<{ payload_json: string }>).reduce((count, outbound) => {
      try {
        const outboundPayload = JSON.parse(outbound.payload_json) as { request?: { msg_id?: unknown } };
        return outboundPayload.request?.msg_id === messageId ? count + 1 : count;
      } catch {
        return count;
      }
    }, 0);
    const maxReplies = targetType === "group" ? 5 : 4;
    if (previousReplies >= maxReplies) throw new Error("MESSAGE_REPLY_LIMIT_REACHED");
    return { msgId: messageId, msgSeq: previousReplies + 1, receivedAt: row.received_at };
  }

  throw new Error("MESSAGE_REPLY_CONTEXT_NOT_FOUND");
}

export function listEvents(user: SessionUser, limit = 100) {
  const database = getDatabase();
  const rows = database.prepare(`SELECT event_logs.*, bots.name AS bot_name FROM event_logs JOIN bots ON bots.id = event_logs.bot_id WHERE bots.user_id = ? ORDER BY received_at DESC LIMIT ?`).all(user.id, limit) as Array<{
      id: string; event_type: string; bot_name: string; scene: EventLog["scene"]; status: EventLog["status"]; latency_ms: number; received_at: string; content: string; payload_json: string; trace_id: string | null;
    }>;
  return rows.map((row) => ({ id: row.id, type: row.event_type, botName: row.bot_name, scene: row.scene, status: row.status, latency: row.latency_ms, time: row.received_at, content: row.content, payload: JSON.parse(row.payload_json), traceId: row.trace_id }));
}
