import "server-only";
import { randomUUID } from "node:crypto";
import { getDatabase } from "@/lib/database";

const LEASE_TTL_MS = 30_000;

type GatewayCoordinationGlobal = typeof globalThis & { __starbotGatewayOwnerId?: string };

export type GatewayShardSession = {
  shardId: number;
  shardCount: number;
  sessionId: string | null;
  sequence: number | null;
  status: "connecting" | "online" | "reconnecting" | "offline";
  lastAckAt: number | null;
};

function ownerId() {
  const state = globalThis as GatewayCoordinationGlobal;
  state.__starbotGatewayOwnerId ||= process.env.GATEWAY_INSTANCE_ID?.trim() || `${process.pid}-${randomUUID()}`;
  return state.__starbotGatewayOwnerId;
}

export function acquireGatewayLease(botId: string, now = Date.now()) {
  const database = getDatabase();
  const owner = ownerId();
  return database.transaction(() => {
    const eligible = database.prepare(`
      SELECT bots.id FROM bots JOIN users ON users.id = bots.user_id
      WHERE bots.id = ? AND bots.auto_connect = 1 AND bots.connection_mode = 'websocket' AND users.status = 'active'
    `).get(botId);
    if (!eligible) return false;
    const current = database.prepare("SELECT owner_id, expires_at FROM gateway_leases WHERE bot_id = ?").get(botId) as { owner_id: string; expires_at: number } | undefined;
    if (current && current.owner_id !== owner && current.expires_at > now) return false;
    database.prepare(`
      INSERT INTO gateway_leases (bot_id, owner_id, expires_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(bot_id) DO UPDATE SET owner_id = excluded.owner_id, expires_at = excluded.expires_at, updated_at = excluded.updated_at
    `).run(botId, owner, now + LEASE_TTL_MS, new Date(now).toISOString());
    return true;
  })();
}

export function renewGatewayLease(botId: string, now = Date.now()) {
  const eligible = getDatabase().prepare(`
    SELECT bots.id FROM bots JOIN users ON users.id = bots.user_id
    WHERE bots.id = ? AND bots.auto_connect = 1 AND bots.connection_mode = 'websocket' AND users.status = 'active'
  `).get(botId);
  if (!eligible) return false;
  const result = getDatabase().prepare(`
    UPDATE gateway_leases SET expires_at = ?, updated_at = ? WHERE bot_id = ? AND owner_id = ?
  `).run(now + LEASE_TTL_MS, new Date(now).toISOString(), botId, ownerId());
  return result.changes === 1;
}

export function releaseGatewayLease(botId: string) {
  getDatabase().prepare("DELETE FROM gateway_leases WHERE bot_id = ? AND owner_id = ?").run(botId, ownerId());
}

export function revokeGatewayLease(botId: string) {
  getDatabase().prepare("DELETE FROM gateway_leases WHERE bot_id = ?").run(botId);
}

export function listGatewayShardSessions(botId: string) {
  const rows = getDatabase().prepare(`
    SELECT shard_id, shard_count, session_id, sequence, status, last_ack_at
    FROM gateway_shard_sessions WHERE bot_id = ? ORDER BY shard_id ASC
  `).all(botId) as Array<{
    shard_id: number;
    shard_count: number;
    session_id: string | null;
    sequence: number | null;
    status: GatewayShardSession["status"];
    last_ack_at: number | null;
  }>;
  return rows.map((row): GatewayShardSession => ({
    shardId: row.shard_id,
    shardCount: row.shard_count,
    sessionId: row.session_id,
    sequence: row.sequence,
    status: row.status,
    lastAckAt: row.last_ack_at,
  }));
}

export function prepareGatewayShards(botId: string, shardCount: number) {
  const database = getDatabase();
  const now = new Date().toISOString();
  database.transaction(() => {
    database.prepare("DELETE FROM gateway_shard_sessions WHERE bot_id = ? AND shard_id >= ?").run(botId, shardCount);
    for (let shardId = 0; shardId < shardCount; shardId += 1) {
      database.prepare(`
        INSERT INTO gateway_shard_sessions (bot_id, shard_id, shard_count, session_id, sequence, status, last_ack_at, updated_at)
        VALUES (?, ?, ?, NULL, NULL, 'connecting', NULL, ?)
        ON CONFLICT(bot_id, shard_id) DO UPDATE SET
          session_id = CASE WHEN gateway_shard_sessions.shard_count = excluded.shard_count THEN gateway_shard_sessions.session_id ELSE NULL END,
          sequence = CASE WHEN gateway_shard_sessions.shard_count = excluded.shard_count THEN gateway_shard_sessions.sequence ELSE NULL END,
          shard_count = excluded.shard_count,
          status = 'connecting',
          last_ack_at = CASE WHEN gateway_shard_sessions.shard_count = excluded.shard_count THEN gateway_shard_sessions.last_ack_at ELSE NULL END,
          updated_at = excluded.updated_at
      `).run(botId, shardId, shardCount, now);
    }
  })();
  return listGatewayShardSessions(botId);
}

export function updateGatewayShardSession(botId: string, shardId: number, input: {
  status: GatewayShardSession["status"];
  sessionId?: string | null;
  sequence?: number | null;
  lastAckAt?: number | null;
}) {
  const current = listGatewayShardSessions(botId).find((session) => session.shardId === shardId);
  if (!current) throw new Error("GATEWAY_SHARD_NOT_FOUND");
  getDatabase().prepare(`
    UPDATE gateway_shard_sessions
    SET session_id = ?, sequence = ?, status = ?, last_ack_at = ?, updated_at = ?
    WHERE bot_id = ? AND shard_id = ?
  `).run(
    input.sessionId === undefined ? current.sessionId : input.sessionId,
    input.sequence === undefined ? current.sequence : input.sequence,
    input.status,
    input.lastAckAt === undefined ? current.lastAckAt : input.lastAckAt,
    new Date().toISOString(),
    botId,
    shardId,
  );
  syncBotGatewayStatus(botId);
}

export function clearGatewayShardSession(botId: string, shardId: number) {
  getDatabase().prepare(`
    UPDATE gateway_shard_sessions SET session_id = NULL, sequence = NULL, status = 'offline', last_ack_at = NULL, updated_at = ?
    WHERE bot_id = ? AND shard_id = ?
  `).run(new Date().toISOString(), botId, shardId);
  syncBotGatewayStatus(botId);
}

export function markGatewayShardsOffline(botId: string) {
  getDatabase().prepare("UPDATE gateway_shard_sessions SET status = 'offline', updated_at = ? WHERE bot_id = ?").run(new Date().toISOString(), botId);
  syncBotGatewayStatus(botId);
}

export function syncBotGatewayStatus(botId: string) {
  const summary = getDatabase().prepare(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) AS online
    FROM gateway_shard_sessions WHERE bot_id = ?
  `).get(botId) as { total: number; online: number | null };
  const online = summary.online || 0;
  const status = online === 0 ? "offline" : online === summary.total ? "online" : "degraded";
  getDatabase().prepare("UPDATE bots SET status = ?, last_seen_at = ?, updated_at = ? WHERE id = ?").run(status, new Date().toISOString(), new Date().toISOString(), botId);
  return { status, online, total: summary.total };
}

export function claimEventReceipt(botId: string, source: "gateway" | "qq_webhook", eventKey: string) {
  try {
    getDatabase().prepare("INSERT INTO event_receipts (bot_id, source, event_key, received_at) VALUES (?, ?, ?, ?)").run(botId, source, eventKey, new Date().toISOString());
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) return false;
    throw error;
  }
}

export function pruneGatewayRuntimeData(now = Date.now()) {
  const database = getDatabase();
  const receiptsBefore = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  database.prepare("DELETE FROM gateway_leases WHERE expires_at <= ?").run(now);
  database.prepare("DELETE FROM event_receipts WHERE received_at < ?").run(receiptsBefore);
}

export const gatewayLeaseTtlMs = LEASE_TTL_MS;
