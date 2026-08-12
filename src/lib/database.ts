import "server-only";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { hashPassword } from "@/lib/password";

type GlobalDatabase = typeof globalThis & {
  __starbotDatabase?: Database.Database;
};

function databasePath() {
  const configured = process.env.DATABASE_PATH;
  if (configured) return path.resolve(configured);
  return path.join(process.cwd(), "data", "starbot.db");
}

function migrate(database: Database.Database) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'developer', 'operator')),
      bot_quota INTEGER NOT NULL DEFAULT 3 CHECK(bot_quota >= 0),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended')),
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      app_id TEXT NOT NULL,
      client_secret_cipher TEXT NOT NULL,
      environment TEXT NOT NULL CHECK(environment IN ('production', 'sandbox')),
      connection_mode TEXT NOT NULL DEFAULT 'websocket' CHECK(connection_mode IN ('websocket', 'webhook')),
      intents INTEGER NOT NULL DEFAULT 33554432,
      status TEXT NOT NULL DEFAULT 'offline' CHECK(status IN ('online', 'degraded', 'offline')),
      gateway_session_id TEXT,
      gateway_sequence INTEGER,
      last_seen_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, app_id)
    );

    CREATE TABLE IF NOT EXISTS event_logs (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      scene TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'warning', 'failed')),
      latency_ms INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL,
      trace_id TEXT,
      received_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS event_logs_bot_received_idx
      ON event_logs(bot_id, received_at DESC);

    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      version TEXT NOT NULL,
      runtime TEXT NOT NULL CHECK(runtime = 'sdk'),
      events_json TEXT NOT NULL,
      permissions_json TEXT NOT NULL,
      signing_secret_cipher TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, slug)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS membership_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      bot_quota INTEGER NOT NULL CHECK(bot_quota >= 0),
      plugin_quota INTEGER NOT NULL CHECK(plugin_quota >= 0),
      event_retention_days INTEGER NOT NULL CHECK(event_retention_days >= 1),
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_memberships (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL REFERENCES membership_plans(id),
      status TEXT NOT NULL CHECK(status IN ('active', 'expired', 'cancelled')),
      starts_at TEXT NOT NULL,
      expires_at TEXT,
      assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plugin_deliveries (
      id TEXT PRIMARY KEY,
      plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'delivering', 'succeeded', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      response_status INTEGER,
      last_error TEXT,
      lease_owner TEXT,
      lease_expires_at INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS plugin_deliveries_due_idx
      ON plugin_deliveries(status, next_attempt_at);

    CREATE TABLE IF NOT EXISTS rate_limit_buckets (
      bucket_key TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      window_started_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_accounts (
      provider TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      profile_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(provider, provider_account_id)
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      state_hash TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plugin_request_nonces (
      plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
      nonce_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY(plugin_id, nonce_hash)
    );

    CREATE TABLE IF NOT EXISTS gateway_shard_sessions (
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      shard_id INTEGER NOT NULL CHECK(shard_id >= 0),
      shard_count INTEGER NOT NULL CHECK(shard_count >= 1),
      session_id TEXT,
      sequence INTEGER,
      status TEXT NOT NULL CHECK(status IN ('connecting', 'online', 'reconnecting', 'offline')),
      last_ack_at INTEGER,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(bot_id, shard_id)
    );

    CREATE TABLE IF NOT EXISTS gateway_leases (
      bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS gateway_leases_expiry_idx
      ON gateway_leases(expires_at);

    CREATE TABLE IF NOT EXISTS event_receipts (
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      source TEXT NOT NULL CHECK(source IN ('gateway', 'qq_webhook')),
      event_key TEXT NOT NULL,
      received_at TEXT NOT NULL,
      PRIMARY KEY(bot_id, event_key)
    );

    CREATE INDEX IF NOT EXISTS event_receipts_received_idx
      ON event_receipts(received_at);

    CREATE UNIQUE INDEX IF NOT EXISTS event_receipts_event_key_idx
      ON event_receipts(bot_id, event_key);

    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const botColumns = database.prepare("PRAGMA table_info(bots)").all() as Array<{ name: string }>;
  if (!botColumns.some((column) => column.name === "auto_connect")) {
    database.exec("ALTER TABLE bots ADD COLUMN auto_connect INTEGER NOT NULL DEFAULT 0");
  }
  if (!botColumns.some((column) => column.name === "connection_mode")) {
    database.exec("ALTER TABLE bots ADD COLUMN connection_mode TEXT NOT NULL DEFAULT 'websocket' CHECK(connection_mode IN ('websocket', 'webhook'))");
  }

  const deliveryColumns = database.prepare("PRAGMA table_info(plugin_deliveries)").all() as Array<{ name: string }>;
  if (!deliveryColumns.some((column) => column.name === "lease_owner")) database.exec("ALTER TABLE plugin_deliveries ADD COLUMN lease_owner TEXT");
  if (!deliveryColumns.some((column) => column.name === "lease_expires_at")) database.exec("ALTER TABLE plugin_deliveries ADD COLUMN lease_expires_at INTEGER");

  const pluginColumns = database.prepare("PRAGMA table_info(plugins)").all() as Array<{ name: string }>;
  if (!pluginColumns.some((column) => column.name === "signing_secret_cipher")) {
    database.pragma("foreign_keys = OFF");
    try {
      database.transaction(() => {
        database.exec(`
          CREATE TABLE plugins_sdk (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            slug TEXT NOT NULL,
            version TEXT NOT NULL,
            runtime TEXT NOT NULL CHECK(runtime = 'sdk'),
            events_json TEXT NOT NULL,
            permissions_json TEXT NOT NULL,
            signing_secret_cipher TEXT,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(user_id, slug)
          );
          INSERT INTO plugins_sdk
            (id, user_id, bot_id, name, slug, version, runtime, events_json, permissions_json, signing_secret_cipher, enabled, created_at, updated_at)
          SELECT id, user_id, bot_id, name, slug, version, 'sdk', events_json, permissions_json,
            webhook_secret_cipher, enabled, created_at, updated_at
          FROM plugins;
          DROP TABLE plugins;
          ALTER TABLE plugins_sdk RENAME TO plugins;
        `);
      })();
    } finally {
      database.pragma("foreign_keys = ON");
    }
    const violations = database.pragma("foreign_key_check") as Array<Record<string, unknown>>;
    if (violations.length) throw new Error("SDK application schema migration left invalid foreign keys");
  }

  const now = new Date().toISOString();
  const insertPlan = database.prepare(`
    INSERT OR IGNORE INTO membership_plans
      (id, name, bot_quota, plugin_quota, event_retention_days, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `);
  insertPlan.run("free", "免费版", 1, 3, 7, now, now);
  insertPlan.run("pro", "专业版", 5, 20, 30, now, now);
  insertPlan.run("team", "团队版", 20, 100, 90, now, now);

  database.prepare(`
    INSERT OR IGNORE INTO user_memberships
      (user_id, plan_id, status, starts_at, expires_at, assigned_by, updated_at)
    SELECT id,
      CASE WHEN bot_quota >= 20 THEN 'team' WHEN bot_quota >= 5 THEN 'pro' ELSE 'free' END,
      'active', created_at, NULL, NULL, ? FROM users
  `).run(now);

  const membershipBackfill = database.prepare("SELECT id FROM schema_migrations WHERE id = ?").get("20260812_membership_backfill");
  if (!membershipBackfill) {
    database.transaction(() => {
      database.prepare(`
        UPDATE user_memberships
        SET plan_id = CASE
          WHEN (SELECT bot_quota FROM users WHERE users.id = user_memberships.user_id) >= 20 THEN 'team'
          WHEN (SELECT bot_quota FROM users WHERE users.id = user_memberships.user_id) >= 5 THEN 'pro'
          ELSE 'free'
        END
        WHERE assigned_by IS NULL
      `).run();
      database.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run("20260812_membership_backfill", now);
    })();
  }

  const developmentNameRepair = database.prepare("SELECT id FROM schema_migrations WHERE id = ?").get("20260812_development_user_name_repair");
  if (!developmentNameRepair) {
    database.transaction(() => {
      database.prepare(`
        UPDATE users SET name = '系统管理员'
        WHERE email = 'admin@starbot.local' AND length(name) > 0 AND name NOT GLOB '*[^?]*'
      `).run();
      database.prepare(`
        UPDATE users SET name = '开发者'
        WHERE email = 'dev@starbot.local' AND length(name) > 0 AND name NOT GLOB '*[^?]*'
      `).run();
      database.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run("20260812_development_user_name_repair", now);
    })();
  }

  database.prepare("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)").run("20260812_sdk_application_schema", now);
}

function seedDevelopmentUsers(database: Database.Database) {
  const row = database.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  if (row.count > 0) return;

  const now = new Date().toISOString();
  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || "admin@starbot.local";
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || (process.env.NODE_ENV === "production" ? "" : "starbot2026");
  if (!adminPassword) throw new Error("BOOTSTRAP_ADMIN_PASSWORD is required when initializing a production database");
  const insert = database.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, bot_quota, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
  `);

  const transaction = database.transaction(() => {
    insert.run(randomUUID(), process.env.BOOTSTRAP_ADMIN_NAME || "系统管理员", adminEmail.toLowerCase(), hashPassword(adminPassword), "admin", 12, now);
    if (process.env.NODE_ENV !== "production") {
      insert.run(randomUUID(), "开发者", "dev@starbot.local", hashPassword("developer2026"), "developer", 5, now);
    }
  });
  transaction();
}

function ensureUserMemberships(database: Database.Database) {
  const now = new Date().toISOString();
  database.prepare(`
    INSERT OR IGNORE INTO user_memberships
      (user_id, plan_id, status, starts_at, expires_at, assigned_by, updated_at)
    SELECT id,
      CASE WHEN bot_quota >= 20 THEN 'team' WHEN bot_quota >= 5 THEN 'pro' ELSE 'free' END,
      'active', created_at, NULL, NULL, ? FROM users
  `).run(now);
}

export function getDatabase() {
  const globalDatabase = globalThis as GlobalDatabase;
  if (globalDatabase.__starbotDatabase) return globalDatabase.__starbotDatabase;

  const filePath = databasePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const database = new Database(filePath);
  migrate(database);
  seedDevelopmentUsers(database);
  ensureUserMemberships(database);
  globalDatabase.__starbotDatabase = database;
  return database;
}

export function writeAuditLog(actorUserId: string | null, action: string, targetType: string, targetId: string | null, metadata: unknown = {}) {
  getDatabase().prepare(`
    INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), actorUserId, action, targetType, targetId, JSON.stringify(metadata), new Date().toISOString());
}
