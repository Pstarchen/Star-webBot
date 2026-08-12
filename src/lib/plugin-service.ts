import "server-only";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/crypto-vault";
import { getBotRow } from "@/lib/bot-service";
import { getDatabase, writeAuditLog } from "@/lib/database";
import type { Plugin, SessionUser } from "@/types/platform";

const MAX_DELIVERY_ATTEMPTS = 5;
const SDK_DELIVERY_LEASE_MS = 60_000;

type PluginRow = {
  id: string;
  user_id: string;
  bot_id: string;
  name: string;
  slug: string;
  version: string;
  runtime: "sdk";
  events_json: string;
  permissions_json: string;
  signing_secret_cipher: string | null;
  enabled: number;
};

type DeliveryRow = {
  id: string;
  event_type: string;
  payload_json: string;
  attempts: number;
  created_at: string;
};

function toPlugin(row: PluginRow): Plugin {
  const pending = getDatabase().prepare(`
    SELECT COUNT(*) AS count FROM plugin_deliveries
    WHERE plugin_id = ? AND status IN ('pending', 'delivering')
  `).get(row.id) as { count: number };
  return {
    id: row.id,
    name: row.name,
    description: "通过 StarBot SDK 消费事件并调用绑定机器人的官方 API",
    version: row.version,
    author: "当前用户",
    icon: "Code2",
    installed: true,
    enabled: Boolean(row.enabled),
    installs: 1,
    category: "SDK 应用",
    runtime: "sdk",
    botId: row.bot_id,
    events: JSON.parse(row.events_json) as string[],
    permissions: JSON.parse(row.permissions_json) as string[],
    pendingEvents: pending.count,
  };
}

export function listPlugins(user: SessionUser) {
  const rows = getDatabase().prepare("SELECT * FROM plugins WHERE user_id = ? ORDER BY created_at DESC").all(user.id) as PluginRow[];
  return rows.map(toPlugin);
}

export function createSdkPlugin(user: SessionUser, input: { botId: string; name: string; slug: string; version: string; events: string[]; permissions: string[] }) {
  getBotRow(user, input.botId);
  const database = getDatabase();
  const plan = database.prepare(`
    SELECT membership_plans.plugin_quota
    FROM user_memberships JOIN membership_plans ON membership_plans.id = user_memberships.plan_id
    WHERE user_memberships.user_id = ? AND user_memberships.status = 'active'
  `).get(user.id) as { plugin_quota: number } | undefined;
  const usage = database.prepare("SELECT COUNT(*) AS count FROM plugins WHERE user_id = ?").get(user.id) as { count: number };
  if (!plan || usage.count >= plan.plugin_quota) throw new Error("PLUGIN_QUOTA_EXCEEDED");

  const secret = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO plugins (id, user_id, bot_id, name, slug, version, runtime, events_json, permissions_json, signing_secret_cipher, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'sdk', ?, ?, ?, 1, ?, ?)
  `).run(id, user.id, input.botId, input.name.trim(), input.slug, input.version, JSON.stringify(input.events), JSON.stringify(input.permissions), encryptSecret(secret), now, now);
  writeAuditLog(user.id, "sdk_app.create", "plugin", id, { botId: input.botId, slug: input.slug });
  const row = database.prepare("SELECT * FROM plugins WHERE id = ?").get(id) as PluginRow;
  return { plugin: toPlugin(row), signingSecret: secret };
}

export function setPluginEnabled(user: SessionUser, pluginId: string, enabled: boolean) {
  const database = getDatabase();
  const row = database.prepare("SELECT * FROM plugins WHERE id = ?").get(pluginId) as PluginRow | undefined;
  if (!row || (user.role !== "admin" && row.user_id !== user.id)) throw new Error("PLUGIN_NOT_FOUND");
  database.prepare("UPDATE plugins SET enabled = ?, updated_at = ? WHERE id = ?").run(enabled ? 1 : 0, new Date().toISOString(), pluginId);
  if (!enabled) {
    database.prepare(`
      UPDATE plugin_deliveries SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE plugin_id = ? AND status = 'delivering'
    `).run(new Date().toISOString(), pluginId);
  }
  writeAuditLog(user.id, enabled ? "sdk_app.enable" : "sdk_app.disable", "plugin", pluginId);
}

function accessiblePlugin(user: SessionUser, pluginId: string) {
  const row = getDatabase().prepare("SELECT * FROM plugins WHERE id = ?").get(pluginId) as PluginRow | undefined;
  if (!row || (user.role !== "admin" && row.user_id !== user.id)) throw new Error("PLUGIN_NOT_FOUND");
  return row;
}

export function rotatePluginSecret(user: SessionUser, pluginId: string) {
  accessiblePlugin(user, pluginId);
  const secret = randomBytes(32).toString("base64url");
  const database = getDatabase();
  database.transaction(() => {
    database.prepare("UPDATE plugins SET signing_secret_cipher = ?, updated_at = ? WHERE id = ?").run(encryptSecret(secret), new Date().toISOString(), pluginId);
    database.prepare("DELETE FROM plugin_request_nonces WHERE plugin_id = ?").run(pluginId);
  })();
  writeAuditLog(user.id, "sdk_app.secret.rotate", "plugin", pluginId);
  return secret;
}

export function deletePlugin(user: SessionUser, pluginId: string) {
  const row = accessiblePlugin(user, pluginId);
  getDatabase().prepare("DELETE FROM plugins WHERE id = ?").run(pluginId);
  writeAuditLog(user.id, "sdk_app.delete", "plugin", pluginId, { slug: row.slug, botId: row.bot_id });
}

function queueDelivery(plugin: PluginRow, eventType: string, payload: unknown) {
  const now = new Date().toISOString();
  const id = randomUUID();
  const envelope = { id, type: eventType, botId: plugin.bot_id, createdAt: now, data: payload };
  getDatabase().prepare(`
    INSERT INTO plugin_deliveries
      (id, plugin_id, bot_id, event_type, payload_json, status, attempts, next_attempt_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
  `).run(id, plugin.id, plugin.bot_id, eventType, JSON.stringify(envelope), now, now, now);
}

export async function dispatchPlugins(botId: string, eventType: string, payload: unknown) {
  const rows = getDatabase().prepare("SELECT * FROM plugins WHERE bot_id = ? AND enabled = 1").all(botId) as PluginRow[];
  rows.filter((plugin) => {
    const permissions = JSON.parse(plugin.permissions_json) as string[];
    const events = JSON.parse(plugin.events_json) as string[];
    return permissions.includes("event:receive") && (events.includes("*") || events.includes(eventType));
  }).forEach((plugin) => queueDelivery(plugin, eventType, payload));
}

function signatureMatches(secret: string, canonical: string, received: string) {
  const expected = `sha256=${createHmac("sha256", secret).update(canonical).digest("hex")}`;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}

export function authenticatePluginRequest(pluginId: string, timestamp: string, nonce: string, body: string, signature: string) {
  return authenticatePluginCanonicalRequest(pluginId, timestamp, nonce, body, signature);
}

export function authenticatePluginCanonicalRequest(pluginId: string, timestamp: string, nonce: string, canonicalPayload: string, signature: string) {
  const timestampValue = Number(timestamp);
  if (!Number.isFinite(timestampValue) || Math.abs(Date.now() - timestampValue) > 5 * 60_000) throw new Error("PLUGIN_REQUEST_EXPIRED");
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) throw new Error("PLUGIN_NONCE_INVALID");

  const database = getDatabase();
  const plugin = database.prepare("SELECT * FROM plugins WHERE id = ? AND enabled = 1").get(pluginId) as PluginRow | undefined;
  if (!plugin?.signing_secret_cipher) throw new Error("PLUGIN_NOT_FOUND");
  if (!signatureMatches(decryptSecret(plugin.signing_secret_cipher), `${timestamp}.${nonce}.${canonicalPayload}`, signature)) throw new Error("PLUGIN_SIGNATURE_INVALID");

  const nonceHash = createHash("sha256").update(nonce).digest("hex");
  const now = Date.now();
  const inserted = database.transaction(() => {
    database.prepare("DELETE FROM plugin_request_nonces WHERE expires_at <= ?").run(now);
    try {
      database.prepare("INSERT INTO plugin_request_nonces (plugin_id, nonce_hash, expires_at) VALUES (?, ?, ?)").run(pluginId, nonceHash, now + 10 * 60_000);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) return false;
      throw error;
    }
  })();
  if (!inserted) throw new Error("PLUGIN_REQUEST_REPLAYED");

  return {
    botId: plugin.bot_id,
    permissions: JSON.parse(plugin.permissions_json) as string[],
  };
}

function recoverExpiredSdkLeases(pluginId: string, now: number) {
  const database = getDatabase();
  database.prepare(`
    UPDATE plugin_deliveries SET status = 'failed', last_error = 'SDK event was not acknowledged after final attempt',
      lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
    WHERE plugin_id = ? AND status = 'delivering' AND attempts >= ? AND COALESCE(lease_expires_at, 0) <= ?
  `).run(new Date(now).toISOString(), pluginId, MAX_DELIVERY_ATTEMPTS, now);
  database.prepare(`
    UPDATE plugin_deliveries SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL,
      next_attempt_at = ?, updated_at = ?
    WHERE plugin_id = ? AND status = 'delivering' AND attempts < ? AND COALESCE(lease_expires_at, 0) <= ?
  `).run(new Date(now).toISOString(), new Date(now).toISOString(), pluginId, MAX_DELIVERY_ATTEMPTS, now);
}

export function claimSdkEvents(pluginId: string, limit: number) {
  const database = getDatabase();
  const leaseToken = randomBytes(24).toString("base64url");
  const now = Date.now();
  const events = database.transaction(() => {
    recoverExpiredSdkLeases(pluginId, now);
    const rows = database.prepare(`
      SELECT id FROM plugin_deliveries
      WHERE plugin_id = ? AND status = 'pending' AND attempts < ? AND next_attempt_at <= ?
      ORDER BY next_attempt_at ASC LIMIT ?
    `).all(pluginId, MAX_DELIVERY_ATTEMPTS, new Date(now).toISOString(), limit) as Array<{ id: string }>;
    if (!rows.length) return [];
    const claim = database.prepare(`
      UPDATE plugin_deliveries SET status = 'delivering', attempts = attempts + 1,
        lease_owner = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND plugin_id = ? AND status = 'pending'
    `);
    for (const row of rows) claim.run(leaseToken, now + SDK_DELIVERY_LEASE_MS, new Date(now).toISOString(), row.id, pluginId);
    return database.prepare(`
      SELECT id, event_type, payload_json, attempts, created_at FROM plugin_deliveries
      WHERE plugin_id = ? AND lease_owner = ? ORDER BY created_at ASC
    `).all(pluginId, leaseToken) as DeliveryRow[];
  })();
  return {
    leaseToken: events.length ? leaseToken : null,
    leaseExpiresAt: events.length ? new Date(now + SDK_DELIVERY_LEASE_MS).toISOString() : null,
    events: events.map((row) => ({ ...JSON.parse(row.payload_json) as Record<string, unknown>, attempt: row.attempts })),
  };
}

export function acknowledgeSdkEvents(pluginId: string, leaseToken: string, deliveryIds: string[]) {
  if (!deliveryIds.length) return 0;
  const database = getDatabase();
  const update = database.prepare(`
    UPDATE plugin_deliveries SET status = 'succeeded', response_status = 204, last_error = NULL,
      lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
    WHERE id = ? AND plugin_id = ? AND status = 'delivering' AND lease_owner = ?
  `);
  return database.transaction(() => {
    const placeholders = deliveryIds.map(() => "?").join(",");
    const owned = database.prepare(`
      SELECT COUNT(*) AS count FROM plugin_deliveries
      WHERE plugin_id = ? AND status = 'delivering' AND lease_owner = ? AND id IN (${placeholders})
    `).get(pluginId, leaseToken, ...deliveryIds) as { count: number };
    if (owned.count !== deliveryIds.length) return 0;
    return deliveryIds.reduce((count, deliveryId) => (
      count + update.run(new Date().toISOString(), deliveryId, pluginId, leaseToken).changes
    ), 0);
  })();
}

export const sdkDeliveryLeaseMs = SDK_DELIVERY_LEASE_MS;
