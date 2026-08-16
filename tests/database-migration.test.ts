import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "starbot-database-migration-test-"));
const databasePath = path.join(temporaryDirectory, "legacy.db");
const now = new Date().toISOString();
const userId = "legacy-user";
const botId = "legacy-bot";
const pluginId = "legacy-plugin";
const deliveryId = "legacy-delivery";
const encryptedSecret = "v1.test.test.test";

let databaseModule: typeof import("@/lib/database");

beforeAll(async () => {
  const legacy = new Database(databasePath);
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'developer', 'operator')), bot_quota INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, last_login_at TEXT
    );
    CREATE TABLE bots (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
      app_id TEXT NOT NULL, client_secret_cipher TEXT NOT NULL, environment TEXT NOT NULL,
      connection_mode TEXT NOT NULL DEFAULT 'websocket', intents INTEGER NOT NULL DEFAULT 33554432,
      status TEXT NOT NULL DEFAULT 'offline', gateway_session_id TEXT, gateway_sequence INTEGER,
      last_seen_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, auto_connect INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, app_id)
    );
    CREATE TABLE plugins (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, name TEXT NOT NULL, slug TEXT NOT NULL,
      version TEXT NOT NULL, runtime TEXT NOT NULL CHECK(runtime IN ('webhook', 'workflow')),
      events_json TEXT NOT NULL, permissions_json TEXT NOT NULL, webhook_url TEXT,
      webhook_secret_cipher TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, UNIQUE(user_id, slug)
    );
    CREATE TABLE plugin_deliveries (
      id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL, response_status INTEGER, last_error TEXT, lease_owner TEXT,
      lease_expires_at INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE plugin_request_nonces (
      plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE, nonce_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL, PRIMARY KEY(plugin_id, nonce_hash)
    );
    CREATE TABLE plugin_market_reviews (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version_id TEXT NOT NULL, requested_by TEXT NOT NULL,
      status TEXT NOT NULL, review_note TEXT, reviewed_by TEXT, requested_at TEXT NOT NULL, reviewed_at TEXT
    );
  `);
  legacy.prepare("INSERT INTO users (id, name, email, password_hash, role, bot_quota, status, created_at) VALUES (?, 'Legacy User', 'legacy@example.com', 'hash', 'developer', 1, 'active', ?)").run(userId, now);
  legacy.prepare("INSERT INTO users (id, name, email, password_hash, role, bot_quota, status, created_at) VALUES ('legacy-admin', '?????', 'admin@starbot.local', 'hash', 'admin', 12, 'active', ?)").run(now);
  legacy.prepare("INSERT INTO users (id, name, email, password_hash, role, bot_quota, status, created_at) VALUES ('legacy-developer', '???', 'dev@starbot.local', 'hash', 'developer', 5, 'active', ?)").run(now);
  legacy.prepare("INSERT INTO bots (id, user_id, name, app_id, client_secret_cipher, environment, created_at, updated_at) VALUES (?, ?, 'Legacy Bot', 'legacy-app', 'cipher', 'sandbox', ?, ?)").run(botId, userId, now, now);
  legacy.prepare(`
    INSERT INTO plugins (id, user_id, bot_id, name, slug, version, runtime, events_json, permissions_json, webhook_url, webhook_secret_cipher, enabled, created_at, updated_at)
    VALUES (?, ?, ?, 'Legacy SDK App', 'legacy-sdk-app', '1.0.0', 'workflow', '["*"]', '["event:receive"]', NULL, ?, 1, ?, ?)
  `).run(pluginId, userId, botId, encryptedSecret, now, now);
  legacy.prepare(`
    INSERT INTO plugin_deliveries (id, plugin_id, bot_id, event_type, payload_json, status, attempts, next_attempt_at, created_at, updated_at)
    VALUES (?, ?, ?, 'C2C_MESSAGE_CREATE', '{}', 'pending', 0, ?, ?, ?)
  `).run(deliveryId, pluginId, botId, now, now, now);
  legacy.prepare("INSERT INTO plugin_request_nonces (plugin_id, nonce_hash, expires_at) VALUES (?, 'legacy-nonce', ?)").run(pluginId, Date.now() + 60_000);
  legacy.prepare("INSERT INTO plugin_market_reviews (id, project_id, version_id, requested_by, status, requested_at) VALUES ('legacy-review', 'legacy-project', 'legacy-version', ?, 'pending', ?)").run(userId, now);
  legacy.close();

  process.env.DATABASE_PATH = databasePath;
  process.env.BOOTSTRAP_ADMIN_EMAIL = "migration-admin@example.com";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "migration-admin-password";
  databaseModule = await import("@/lib/database");
  databaseModule.getDatabase();
});

afterAll(() => {
  const state = globalThis as typeof globalThis & { __starbotDatabase?: { close(): void } };
  state.__starbotDatabase?.close();
  delete state.__starbotDatabase;
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("SDK application schema migration", () => {
  it("renames the runtime and secret field without losing related data", () => {
    const database = databaseModule.getDatabase();
    const columns = database.prepare("PRAGMA table_info(plugins)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain("signing_secret_cipher");
    expect(columns.map((column) => column.name)).not.toContain("webhook_url");
    expect(columns.map((column) => column.name)).not.toContain("webhook_secret_cipher");
    expect(database.prepare("SELECT runtime, signing_secret_cipher FROM plugins WHERE id = ?").get(pluginId)).toEqual({
      runtime: "sdk",
      signing_secret_cipher: encryptedSecret,
    });
    expect(database.prepare("SELECT plugin_id FROM plugin_deliveries WHERE id = ?").get(deliveryId)).toEqual({ plugin_id: pluginId });
    expect(database.prepare("SELECT nonce_hash FROM plugin_request_nonces WHERE plugin_id = ?").get(pluginId)).toEqual({ nonce_hash: "legacy-nonce" });
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  it("repairs only the known development seed account names", () => {
    const database = databaseModule.getDatabase();
    expect(database.prepare("SELECT name FROM users WHERE email = 'admin@starbot.local'").get()).toEqual({ name: "系统管理员" });
    expect(database.prepare("SELECT name FROM users WHERE email = 'dev@starbot.local'").get()).toEqual({ name: "开发者" });
    expect(database.prepare("SELECT name FROM users WHERE email = 'legacy@example.com'").get()).toEqual({ name: "Legacy User" });
  });

  it("adds and backfills the portable pending review marker", () => {
    const database = databaseModule.getDatabase();
    const columns = database.prepare("PRAGMA table_info(plugin_market_reviews)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain("pending_project_id");
    expect(database.prepare("SELECT pending_project_id FROM plugin_market_reviews WHERE id = 'legacy-review'").get()).toEqual({ pending_project_id: "legacy-project" });
  });
});
