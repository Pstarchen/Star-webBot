import "server-only";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { captureDatabaseConfigurationFile, databaseConfigurationFromInput, databaseConfigurationIsEnvironmentManaged, databaseConfigurationKey, getDatabaseConfiguration, persistDatabaseConfiguration, restoreDatabaseConfigurationFile, type DatabaseConfiguration, type DatabaseConfigurationInput } from "@/lib/database-config";
import { mysqlSchemaForIndexedIdentifierLength, type MySqlIndexedIdentifierLength } from "@/lib/mysql-schema";
import { createMySqlDatabase, type PlatformDatabase } from "@/lib/mysql-sync";
import { hashPassword } from "@/lib/password";

type GlobalDatabase = typeof globalThis & {
  __starbotDatabase?: PlatformDatabase;
  __starbotDatabaseConfigurationKey?: string;
  __starbotMembershipExpiryCheckedAt?: number;
};

function migrateSqlite(database: Database.Database) {
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

    CREATE TABLE IF NOT EXISTS plugin_projects (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      author TEXT NOT NULL,
      category TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'private' CHECK(status IN ('private', 'pending', 'published', 'rejected', 'suspended')),
      review_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(owner_user_id, slug)
    );

    CREATE TABLE IF NOT EXISTS plugin_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES plugin_projects(id) ON DELETE CASCADE,
      version TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      entry_code TEXT NOT NULL,
      config_page_html TEXT,
      readme TEXT,
      package_sha256 TEXT NOT NULL,
      package_size INTEGER NOT NULL CHECK(package_size >= 0),
      validation_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'withdrawn')),
      created_at TEXT NOT NULL,
      UNIQUE(project_id, version)
    );

    CREATE INDEX IF NOT EXISTS plugin_versions_project_created_idx
      ON plugin_versions(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS plugin_installations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES plugin_projects(id) ON DELETE CASCADE,
      version_id TEXT NOT NULL REFERENCES plugin_versions(id),
      enabled INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 50 CHECK(priority BETWEEN 1 AND 100),
      failure_count INTEGER NOT NULL DEFAULT 0 CHECK(failure_count >= 0),
      last_error TEXT,
      last_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(bot_id, project_id)
    );

    CREATE INDEX IF NOT EXISTS plugin_installations_bot_enabled_idx
      ON plugin_installations(bot_id, enabled, priority);

    CREATE TABLE IF NOT EXISTS plugin_config_values (
      installation_id TEXT NOT NULL REFERENCES plugin_installations(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(installation_id, key)
    );

    CREATE TABLE IF NOT EXISTS plugin_kv (
      installation_id TEXT NOT NULL REFERENCES plugin_installations(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(installation_id, key)
    );

    CREATE TABLE IF NOT EXISTS plugin_runs (
      id TEXT PRIMARY KEY,
      installation_id TEXT NOT NULL REFERENCES plugin_installations(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      event_key TEXT,
      status TEXT NOT NULL CHECK(status IN ('success', 'skipped', 'failed')),
      duration_ms INTEGER NOT NULL DEFAULT 0,
      action_count INTEGER NOT NULL DEFAULT 0,
      logs_json TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS plugin_runs_installation_created_idx
      ON plugin_runs(installation_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS plugin_market_reviews (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES plugin_projects(id) ON DELETE CASCADE,
      version_id TEXT NOT NULL REFERENCES plugin_versions(id) ON DELETE CASCADE,
      requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
      pending_project_id TEXT,
      review_note TEXT,
      reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      requested_at TEXT NOT NULL,
      reviewed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS plugin_market_reviews_status_requested_idx
      ON plugin_market_reviews(status, requested_at DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS plugin_market_reviews_pending_project_idx
      ON plugin_market_reviews(project_id) WHERE status = 'pending';

    CREATE TABLE IF NOT EXISTS plugin_market_listings (
      project_id TEXT PRIMARY KEY REFERENCES plugin_projects(id) ON DELETE CASCADE,
      version_id TEXT NOT NULL REFERENCES plugin_versions(id),
      featured INTEGER NOT NULL DEFAULT 0,
      price_cents INTEGER NOT NULL DEFAULT 0 CHECK(price_cents >= 0),
      display_name TEXT,
      display_description TEXT,
      display_author TEXT,
      display_category TEXT,
      display_tags_json TEXT,
      published_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      published_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      site_name TEXT NOT NULL,
      site_tagline TEXT NOT NULL,
      site_description TEXT NOT NULL,
      site_logo_mime TEXT,
      site_logo_blob BLOB,
      site_favicon_mime TEXT,
      site_favicon_blob BLOB,
      icp_code TEXT NOT NULL DEFAULT '',
      icp_url TEXT NOT NULL DEFAULT 'https://beian.miit.gov.cn/',
      police_code TEXT NOT NULL DEFAULT '',
      police_url TEXT NOT NULL DEFAULT '',
      copyright_text TEXT NOT NULL DEFAULT '',
      qq_login_enabled INTEGER NOT NULL DEFAULT 0,
      qq_app_id TEXT NOT NULL DEFAULT '',
      qq_app_secret_cipher TEXT,
      qq_redirect_uri TEXT NOT NULL DEFAULT '',
      payment_enabled INTEGER NOT NULL DEFAULT 0,
      payment_provider TEXT NOT NULL DEFAULT 'sandbox' CHECK(payment_provider IN ('sandbox', 'manual', 'epay')),
      epay_gateway_url TEXT NOT NULL DEFAULT '',
      epay_pid TEXT NOT NULL DEFAULT '',
      epay_key_cipher TEXT,
      manual_payment_instructions TEXT NOT NULL DEFAULT '',
      email_registration_verification_enabled INTEGER NOT NULL DEFAULT 0,
      email_login_enabled INTEGER NOT NULL DEFAULT 0,
      smtp_host TEXT NOT NULL DEFAULT '',
      smtp_port INTEGER NOT NULL DEFAULT 587 CHECK(smtp_port BETWEEN 1 AND 65535),
      smtp_secure INTEGER NOT NULL DEFAULT 0,
      smtp_starttls INTEGER NOT NULL DEFAULT 1,
      smtp_from TEXT NOT NULL DEFAULT '',
      smtp_user TEXT NOT NULL DEFAULT '',
      smtp_pass_cipher TEXT,
      time_zone TEXT NOT NULL DEFAULT '',
      install_completed INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS site_asset_chunks (
      kind TEXT NOT NULL CHECK(kind IN ('logo', 'favicon')),
      chunk_index INTEGER NOT NULL CHECK(chunk_index >= 0),
      data_blob BLOB NOT NULL,
      PRIMARY KEY(kind, chunk_index)
    );

    CREATE TABLE IF NOT EXISTS membership_orders (
      id TEXT PRIMARY KEY,
      order_no TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL REFERENCES membership_plans(id),
      billing_cycle TEXT NOT NULL CHECK(billing_cycle IN ('monthly', 'quarterly', 'yearly')),
      payment_channel TEXT NOT NULL CHECK(payment_channel IN ('alipay', 'wxpay', 'qqpay', 'manual', 'sandbox')),
      amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
      provider TEXT NOT NULL CHECK(provider IN ('sandbox', 'manual', 'epay')),
      status TEXT NOT NULL CHECK(status IN ('pending', 'paid', 'cancelled', 'expired', 'failed')),
      payment_url TEXT,
      provider_trade_no TEXT,
      payment_note TEXT,
      created_at TEXT NOT NULL,
      paid_at TEXT,
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS membership_orders_user_created_idx
      ON membership_orders(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS membership_orders_status_created_idx
      ON membership_orders(status, created_at DESC);

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

    CREATE TABLE IF NOT EXISTS email_verification_codes (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK(purpose IN ('login', 'register')),
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS email_verification_codes_lookup_idx
      ON email_verification_codes(email, purpose, created_at DESC);

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

    CREATE TABLE IF NOT EXISTS qq_bot_qr_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      environment TEXT NOT NULL CHECK(environment IN ('production', 'sandbox')),
      connection_mode TEXT NOT NULL CHECK(connection_mode IN ('websocket', 'webhook')),
      status TEXT NOT NULL CHECK(status IN ('pending', 'scanning', 'completed', 'expired', 'cancelled', 'failed')),
      qr_url_cipher TEXT,
      qr_revision INTEGER NOT NULL DEFAULT 0,
      bot_id TEXT REFERENCES bots(id) ON DELETE SET NULL,
      error_code TEXT,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS qq_bot_qr_sessions_user_status_idx
      ON qq_bot_qr_sessions(user_id, status, created_at DESC);

    CREATE INDEX IF NOT EXISTS qq_bot_qr_sessions_expiry_idx
      ON qq_bot_qr_sessions(expires_at);

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

  const reviewColumns = database.prepare("PRAGMA table_info(plugin_market_reviews)").all() as Array<{ name: string }>;
  if (!reviewColumns.some((column) => column.name === "pending_project_id")) {
    database.exec("ALTER TABLE plugin_market_reviews ADD COLUMN pending_project_id TEXT");
  }
  database.prepare("UPDATE plugin_market_reviews SET pending_project_id = project_id WHERE status = 'pending' AND pending_project_id IS NULL").run();
  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS plugin_market_reviews_pending_marker_idx ON plugin_market_reviews(pending_project_id)");

  const pluginVersionColumns = database.prepare("PRAGMA table_info(plugin_versions)").all() as Array<{ name: string }>;
  if (!pluginVersionColumns.some((column) => column.name === "config_page_html")) database.exec("ALTER TABLE plugin_versions ADD COLUMN config_page_html TEXT");

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

  const marketplaceColumns = database.prepare("PRAGMA table_info(plugin_market_listings)").all() as Array<{ name: string }>;
  if (!marketplaceColumns.some((column) => column.name === "display_name")) database.exec("ALTER TABLE plugin_market_listings ADD COLUMN display_name TEXT");
  if (!marketplaceColumns.some((column) => column.name === "display_description")) database.exec("ALTER TABLE plugin_market_listings ADD COLUMN display_description TEXT");
  if (!marketplaceColumns.some((column) => column.name === "display_author")) database.exec("ALTER TABLE plugin_market_listings ADD COLUMN display_author TEXT");
  if (!marketplaceColumns.some((column) => column.name === "display_category")) database.exec("ALTER TABLE plugin_market_listings ADD COLUMN display_category TEXT");
  if (!marketplaceColumns.some((column) => column.name === "display_tags_json")) database.exec("ALTER TABLE plugin_market_listings ADD COLUMN display_tags_json TEXT");

  const settingsColumns = database.prepare("PRAGMA table_info(system_settings)").all() as Array<{ name: string }>;
  if (!settingsColumns.some((column) => column.name === "email_registration_verification_enabled")) database.exec("ALTER TABLE system_settings ADD COLUMN email_registration_verification_enabled INTEGER NOT NULL DEFAULT 0");
  if (!settingsColumns.some((column) => column.name === "email_login_enabled")) database.exec("ALTER TABLE system_settings ADD COLUMN email_login_enabled INTEGER NOT NULL DEFAULT 0");
  if (!settingsColumns.some((column) => column.name === "smtp_host")) database.exec("ALTER TABLE system_settings ADD COLUMN smtp_host TEXT NOT NULL DEFAULT ''");
  if (!settingsColumns.some((column) => column.name === "smtp_port")) database.exec("ALTER TABLE system_settings ADD COLUMN smtp_port INTEGER NOT NULL DEFAULT 587 CHECK(smtp_port BETWEEN 1 AND 65535)");
  if (!settingsColumns.some((column) => column.name === "smtp_secure")) database.exec("ALTER TABLE system_settings ADD COLUMN smtp_secure INTEGER NOT NULL DEFAULT 0");
  if (!settingsColumns.some((column) => column.name === "smtp_starttls")) database.exec("ALTER TABLE system_settings ADD COLUMN smtp_starttls INTEGER NOT NULL DEFAULT 1");
  if (!settingsColumns.some((column) => column.name === "smtp_from")) database.exec("ALTER TABLE system_settings ADD COLUMN smtp_from TEXT NOT NULL DEFAULT ''");
  if (!settingsColumns.some((column) => column.name === "smtp_user")) database.exec("ALTER TABLE system_settings ADD COLUMN smtp_user TEXT NOT NULL DEFAULT ''");
  if (!settingsColumns.some((column) => column.name === "smtp_pass_cipher")) database.exec("ALTER TABLE system_settings ADD COLUMN smtp_pass_cipher TEXT");
  if (!settingsColumns.some((column) => column.name === "time_zone")) database.exec("ALTER TABLE system_settings ADD COLUMN time_zone TEXT NOT NULL DEFAULT ''");
  if (!settingsColumns.some((column) => column.name === "install_completed")) database.exec("ALTER TABLE system_settings ADD COLUMN install_completed INTEGER NOT NULL DEFAULT 0");

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
  const membershipPlanColumns = database.prepare("PRAGMA table_info(membership_plans)").all() as Array<{ name: string }>;
  if (!membershipPlanColumns.some((column) => column.name === "description")) database.exec("ALTER TABLE membership_plans ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  if (!membershipPlanColumns.some((column) => column.name === "monthly_price_cents")) database.exec("ALTER TABLE membership_plans ADD COLUMN monthly_price_cents INTEGER NOT NULL DEFAULT 0");
  if (!membershipPlanColumns.some((column) => column.name === "quarterly_price_cents")) database.exec("ALTER TABLE membership_plans ADD COLUMN quarterly_price_cents INTEGER NOT NULL DEFAULT 0");
  if (!membershipPlanColumns.some((column) => column.name === "yearly_price_cents")) database.exec("ALTER TABLE membership_plans ADD COLUMN yearly_price_cents INTEGER NOT NULL DEFAULT 0");
  if (!membershipPlanColumns.some((column) => column.name === "features_json")) database.exec("ALTER TABLE membership_plans ADD COLUMN features_json TEXT NOT NULL DEFAULT '[]'");
  const insertPlan = database.prepare(`
    INSERT OR IGNORE INTO membership_plans
      (id, name, bot_quota, plugin_quota, event_retention_days, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `);
  insertPlan.run("free", "免费版", 1, 3, 7, now, now);
  insertPlan.run("pro", "专业版", 5, 20, 30, now, now);
  insertPlan.run("team", "团队版", 20, 100, 90, now, now);

  database.prepare(`
    UPDATE membership_plans SET
      description = CASE id
        WHEN 'free' THEN '适合个人体验与轻量机器人开发'
        WHEN 'pro' THEN '适合持续运营多个机器人和插件'
        WHEN 'team' THEN '适合团队协作与高频事件处理'
        ELSE description END,
      monthly_price_cents = CASE id WHEN 'pro' THEN 2900 WHEN 'team' THEN 9900 ELSE monthly_price_cents END,
      quarterly_price_cents = CASE id WHEN 'pro' THEN 7900 WHEN 'team' THEN 26900 ELSE quarterly_price_cents END,
      yearly_price_cents = CASE id WHEN 'pro' THEN 29900 WHEN 'team' THEN 99900 ELSE yearly_price_cents END,
      features_json = CASE id
        WHEN 'free' THEN '["1 个机器人","3 个插件安装","事件保留 7 天"]'
        WHEN 'pro' THEN '["5 个机器人","20 个插件安装","事件保留 30 天","优先事件处理"]'
        WHEN 'team' THEN '["20 个机器人","100 个插件安装","事件保留 90 天","团队协作权限"]'
        ELSE features_json END,
      updated_at = ?
    WHERE id IN ('free', 'pro', 'team') AND (description = '' OR features_json = '[]')
  `).run(now);

  database.prepare(`
    INSERT OR IGNORE INTO system_settings
      (id, site_name, site_tagline, site_description, copyright_text, payment_enabled, payment_provider, manual_payment_instructions, updated_at)
    VALUES (1, 'StarBot', 'QQ Bot Console', '面向团队的多用户、多机器人、可扩展 QQ 官方机器人管理与开发平台。', 'StarBot', ?, 'sandbox', '提交订单后请联系管理员，并提供订单号完成审核。', ?)
  `).run(process.env.NODE_ENV === "production" ? 0 : 1, now);

  if ((database.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count > 0) {
    database.prepare("UPDATE system_settings SET install_completed = 1 WHERE id = 1 AND install_completed = 0").run();
  }

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
  database.prepare("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)").run("20260813_system_settings_and_billing", now);
}

function existingMySqlIndexedIdentifierLength(database: PlatformDatabase): MySqlIndexedIdentifierLength {
  const column = database.prepare(`
    SELECT CHARACTER_MAXIMUM_LENGTH AS identifier_length,
      CHARACTER_SET_NAME AS character_set_name,
      COLLATION_NAME AS collation_name
    FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'id'
  `).get() as { identifier_length: number; character_set_name: string; collation_name: string } | undefined;
  if (!column) return 64;
  if (column.character_set_name !== "utf8mb4" || column.collation_name !== "utf8mb4_unicode_ci") {
    throw new Error("MYSQL_EXISTING_SCHEMA_INCOMPATIBLE");
  }
  const length = Number(column.identifier_length);
  if (length !== 64 && length !== 191) throw new Error("MYSQL_EXISTING_SCHEMA_INCOMPATIBLE");
  return length;
}

function migrateMySql(database: PlatformDatabase) {
  const indexedIdentifierLength = existingMySqlIndexedIdentifierLength(database);
  database.exec(mysqlSchemaForIndexedIdentifierLength(indexedIdentifierLength));
  const pluginConfigPageColumn = database.prepare(`
    SELECT 1 AS found FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'plugin_versions' AND column_name = 'config_page_html'
    LIMIT 1
  `).get();
  if (!pluginConfigPageColumn) database.exec("ALTER TABLE plugin_versions ADD COLUMN config_page_html LONGTEXT NULL AFTER entry_code");
  const timeZoneColumn = database.prepare(`
    SELECT 1 AS found FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'system_settings' AND column_name = 'time_zone'
    LIMIT 1
  `).get();
  if (!timeZoneColumn) database.exec("ALTER TABLE system_settings ADD COLUMN time_zone VARCHAR(100) NOT NULL DEFAULT '' AFTER smtp_pass_cipher");
  const pendingReviewColumn = database.prepare(`
    SELECT EXTRA AS extra FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'plugin_market_reviews' AND column_name = 'pending_project_id'
  `).get() as { extra: string } | undefined;
  if (pendingReviewColumn?.extra.toUpperCase().includes("GENERATED")) {
    const generatedIndex = database.prepare(`
      SELECT 1 AS found FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'plugin_market_reviews' AND index_name = 'plugin_market_reviews_pending_idx'
      LIMIT 1
    `).get();
    if (generatedIndex) database.exec("ALTER TABLE plugin_market_reviews DROP INDEX plugin_market_reviews_pending_idx");
    database.exec("ALTER TABLE plugin_market_reviews DROP COLUMN pending_project_id");
    database.exec(`ALTER TABLE plugin_market_reviews ADD COLUMN pending_project_id VARCHAR(${indexedIdentifierLength}) NULL AFTER status`);
  } else if (!pendingReviewColumn) {
    database.exec(`ALTER TABLE plugin_market_reviews ADD COLUMN pending_project_id VARCHAR(${indexedIdentifierLength}) NULL AFTER status`);
  }
  database.prepare("UPDATE plugin_market_reviews SET pending_project_id = project_id WHERE status = 'pending' AND pending_project_id IS NULL").run();
  const pendingReviewIndex = database.prepare(`
    SELECT 1 AS found FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'plugin_market_reviews' AND index_name = 'plugin_market_reviews_pending_idx'
    LIMIT 1
  `).get();
  if (!pendingReviewIndex) database.exec("CREATE UNIQUE INDEX plugin_market_reviews_pending_idx ON plugin_market_reviews(pending_project_id)");
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
    UPDATE membership_plans SET
      description = CASE id
        WHEN 'free' THEN '适合个人体验与轻量机器人开发'
        WHEN 'pro' THEN '适合持续运营多个机器人和插件'
        WHEN 'team' THEN '适合团队协作与高频事件处理'
        ELSE description END,
      monthly_price_cents = CASE id WHEN 'pro' THEN 2900 WHEN 'team' THEN 9900 ELSE monthly_price_cents END,
      quarterly_price_cents = CASE id WHEN 'pro' THEN 7900 WHEN 'team' THEN 26900 ELSE quarterly_price_cents END,
      yearly_price_cents = CASE id WHEN 'pro' THEN 29900 WHEN 'team' THEN 99900 ELSE yearly_price_cents END,
      features_json = CASE id
        WHEN 'free' THEN '["1 个机器人","3 个插件安装","事件保留 7 天"]'
        WHEN 'pro' THEN '["5 个机器人","20 个插件安装","事件保留 30 天","优先事件处理"]'
        WHEN 'team' THEN '["20 个机器人","100 个插件安装","事件保留 90 天","团队协作权限"]'
        ELSE features_json END,
      updated_at = ?
    WHERE id IN ('free', 'pro', 'team') AND (description = '' OR features_json = '[]')
  `).run(now);

  database.prepare(`
    INSERT OR IGNORE INTO system_settings
      (id, site_name, site_tagline, site_description, copyright_text, payment_enabled, payment_provider, manual_payment_instructions, updated_at)
    VALUES (1, 'StarBot', 'QQ Bot Console', '面向团队的多用户、多机器人、可扩展 QQ 官方机器人管理与开发平台。', 'StarBot', ?, 'sandbox', '提交订单后请联系管理员，并提供订单号完成审核。', ?)
  `).run(process.env.NODE_ENV === "production" ? 0 : 1, now);

  if ((database.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count > 0) {
    database.prepare("UPDATE system_settings SET install_completed = 1 WHERE id = 1 AND install_completed = 0").run();
  }
  database.prepare(`
    INSERT OR IGNORE INTO user_memberships
      (user_id, plan_id, status, starts_at, expires_at, assigned_by, updated_at)
    SELECT id,
      CASE WHEN bot_quota >= 20 THEN 'team' WHEN bot_quota >= 5 THEN 'pro' ELSE 'free' END,
      'active', created_at, NULL, NULL, ? FROM users
  `).run(now);
  database.prepare("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)").run("20260812_sdk_application_schema", now);
  database.prepare("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)").run("20260813_system_settings_and_billing", now);
}

function expirePaidMemberships(database: PlatformDatabase) {
  const nowMs = Date.now();
  const state = globalThis as GlobalDatabase;
  if (state.__starbotMembershipExpiryCheckedAt && nowMs - state.__starbotMembershipExpiryCheckedAt < 30_000) return;
  state.__starbotMembershipExpiryCheckedAt = nowMs;
  const now = new Date(nowMs).toISOString();
  const expired = database.prepare(`
    SELECT user_id FROM user_memberships
    WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?
  `).all(now) as Array<{ user_id: string }>;
  if (!expired.length) return;
  const freePlan = database.prepare("SELECT bot_quota FROM membership_plans WHERE id = 'free'").get() as { bot_quota: number };
  database.transaction(() => {
    for (const membership of expired) {
      const usage = database.prepare("SELECT COUNT(*) AS count FROM bots WHERE user_id = ?").get(membership.user_id) as { count: number };
      database.prepare("UPDATE users SET bot_quota = ? WHERE id = ?").run(Math.max(usage.count, freePlan.bot_quota), membership.user_id);
      database.prepare("UPDATE user_memberships SET status = 'expired', updated_at = ? WHERE user_id = ?").run(now, membership.user_id);
    }
  })();
}

function seedDevelopmentUsers(database: PlatformDatabase) {
  const row = database.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  if (row.count > 0) return;

  const now = new Date().toISOString();
  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || "admin@starbot.local";
  const bootstrapConfigured = Boolean(process.env.BOOTSTRAP_ADMIN_EMAIL || process.env.BOOTSTRAP_ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_NAME);
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || (bootstrapConfigured && process.env.NODE_ENV !== "production" ? "starbot2026" : "");
  if (!adminPassword) return;
  const insert = database.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, bot_quota, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
  `);

  const transaction = database.transaction(() => {
    insert.run(randomUUID(), process.env.BOOTSTRAP_ADMIN_NAME || "系统管理员", adminEmail.toLowerCase(), hashPassword(adminPassword), "admin", 12, now);
    if (process.env.NODE_ENV !== "production") {
      insert.run(randomUUID(), "开发者", "dev@starbot.local", hashPassword("developer2026"), "developer", 5, now);
    }
    database.prepare("UPDATE system_settings SET install_completed = 1, updated_at = ? WHERE id = 1").run(now);
  });
  transaction();
}

function seedOfficialPlugins(database: PlatformDatabase) {
  const owner = database.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
  if (!owner) return;

  const now = new Date().toISOString();
  const projectId = "starbot-official-keyword-reply";
  const versionId = "starbot-official-keyword-reply-v1";
  const manifest = {
    schemaVersion: 1,
    id: "keyword-reply",
    name: "关键词自动回复",
    version: "1.0.0",
    description: "命中指定关键词后自动回复，适合欢迎语、常见问题与快捷引导。",
    author: "StarBot",
    category: "消息互动",
    tags: ["自动回复", "官方"],
    entry: "index.js",
    events: ["C2C_MESSAGE_CREATE", "GROUP_AT_MESSAGE_CREATE"],
    permissions: ["reply:text", "log:write"],
    commands: [{ name: "关键词触发", description: "消息包含关键词时回复" }],
    configSchema: [
      { key: "keyword", label: "触发关键词", type: "text", required: true, default: "你好", placeholder: "例如：你好" },
      { key: "reply", label: "回复内容", type: "textarea", required: true, default: "你好，我是由 StarBot 托管运行的 QQ 机器人。" },
    ],
  };
  const entryCode = `StarBot.definePlugin({
  onEvent(event, sdk) {
    const content = String(event.data && event.data.content || "").trim();
    if (content.includes(String(sdk.config.keyword || ""))) {
      sdk.reply.text(String(sdk.config.reply || ""));
      sdk.log.info("关键词已命中");
    }
  }
});`;

  database.transaction(() => {
    database.prepare(`
      INSERT OR IGNORE INTO plugin_projects
        (id, owner_user_id, slug, name, description, author, category, tags_json, status, review_note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', NULL, ?, ?)
    `).run(projectId, owner.id, manifest.id, manifest.name, manifest.description, manifest.author, manifest.category, JSON.stringify(manifest.tags), now, now);
    database.prepare(`
      INSERT OR IGNORE INTO plugin_versions
        (id, project_id, version, manifest_json, entry_code, readme, package_sha256, package_size, validation_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'active', ?)
    `).run(versionId, projectId, manifest.version, JSON.stringify(manifest), entryCode, "# 关键词自动回复\n\n安装后配置触发关键词和回复内容即可。", "builtin:keyword-reply:1.0.0", JSON.stringify({ source: "builtin", scanner: "trusted" }), now);
    const publishedProject = database.prepare("SELECT 1 AS found FROM plugin_projects WHERE id = ? AND status = 'published'").get(projectId);
    if (publishedProject) {
      database.prepare(`
        INSERT OR IGNORE INTO plugin_market_listings
          (project_id, version_id, featured, price_cents, published_by, published_at, updated_at)
        VALUES (?, ?, 1, 0, ?, ?, ?)
      `).run(projectId, versionId, owner.id, now, now);
    }
  })();
}

function ensureUserMemberships(database: PlatformDatabase) {
  const now = new Date().toISOString();
  database.prepare(`
    INSERT OR IGNORE INTO user_memberships
      (user_id, plan_id, status, starts_at, expires_at, assigned_by, updated_at)
    SELECT id,
      CASE WHEN bot_quota >= 20 THEN 'team' WHEN bot_quota >= 5 THEN 'pro' ELSE 'free' END,
      'active', created_at, NULL, NULL, ? FROM users
  `).run(now);
}

function openDatabase(configuration: DatabaseConfiguration, options: { seedDevelopmentUsers: boolean }) {
  let database: PlatformDatabase | null = null;
  try {
    if (configuration.provider === "sqlite") {
      fs.mkdirSync(path.dirname(configuration.path), { recursive: true });
      const sqlite = new Database(configuration.path);
      migrateSqlite(sqlite);
      database = sqlite as unknown as PlatformDatabase;
    } else {
      database = createMySqlDatabase(configuration.config);
      migrateMySql(database);
    }
    if (!database) throw new Error("DATABASE_OPEN_FAILED");
    if (options.seedDevelopmentUsers) seedDevelopmentUsers(database);
    seedOfficialPlugins(database);
    ensureUserMemberships(database);
    expirePaidMemberships(database);
    return database;
  } catch (error) {
    database?.close();
    throw error;
  }
}

function resetMembershipExpiryCheck() {
  delete (globalThis as GlobalDatabase).__starbotMembershipExpiryCheckedAt;
}

export function getDatabase(): PlatformDatabase {
  const globalDatabase = globalThis as GlobalDatabase;
  const configuration = getDatabaseConfiguration();
  const configurationKey = databaseConfigurationKey(configuration);
  if (globalDatabase.__starbotDatabase && globalDatabase.__starbotDatabaseConfigurationKey === configurationKey) {
    expirePaidMemberships(globalDatabase.__starbotDatabase);
    return globalDatabase.__starbotDatabase;
  }
  globalDatabase.__starbotDatabase?.close();
  resetMembershipExpiryCheck();
  const database = openDatabase(configuration, { seedDevelopmentUsers: true });
  globalDatabase.__starbotDatabase = database;
  globalDatabase.__starbotDatabaseConfigurationKey = configurationKey;
  return database;
}

export type DatabaseInstallationHandle = {
  configuration: DatabaseConfiguration;
  persist: () => void;
  commit: () => void;
  rollback: () => void;
};

export function beginDatabaseInstallation(input: DatabaseConfigurationInput): DatabaseInstallationHandle {
  const globalDatabase = globalThis as GlobalDatabase;
  const previousDatabase = globalDatabase.__starbotDatabase;
  const previousConfigurationKey = globalDatabase.__starbotDatabaseConfigurationKey;
  const configuration = databaseConfigurationIsEnvironmentManaged() ? getDatabaseConfiguration() : databaseConfigurationFromInput(input);
  const configurationKey = databaseConfigurationKey(configuration);
  const configurationSnapshot = captureDatabaseConfigurationFile();
  const candidate = previousDatabase !== undefined && previousConfigurationKey === configurationKey
    ? previousDatabase
    : openDatabase(configuration, { seedDevelopmentUsers: false });
  globalDatabase.__starbotDatabase = candidate;
  globalDatabase.__starbotDatabaseConfigurationKey = configurationKey;
  resetMembershipExpiryCheck();
  let persisted = false;
  let finalized = false;

  return {
    configuration,
    persist() {
      if (persisted) return;
      if (!databaseConfigurationIsEnvironmentManaged()) persistDatabaseConfiguration(configuration);
      persisted = true;
    },
    commit() {
      if (finalized) return;
      if (candidate !== previousDatabase) previousDatabase?.close();
      finalized = true;
    },
    rollback() {
      if (finalized) return;
      if (candidate !== previousDatabase) candidate.close();
      globalDatabase.__starbotDatabase = previousDatabase;
      globalDatabase.__starbotDatabaseConfigurationKey = previousConfigurationKey;
      resetMembershipExpiryCheck();
      if (persisted && !databaseConfigurationIsEnvironmentManaged()) restoreDatabaseConfigurationFile(configurationSnapshot);
      finalized = true;
    },
  };
}

export function testDatabaseConfiguration(input: DatabaseConfigurationInput) {
  const configuration = databaseConfigurationIsEnvironmentManaged() ? getDatabaseConfiguration() : databaseConfigurationFromInput(input);
  const database = openDatabase(configuration, { seedDevelopmentUsers: false });
  try {
    database.prepare("SELECT 1 AS connected").get();
  } finally {
    database.close();
  }
  return configuration.provider;
}

export function seedPostInstallationData(database = getDatabase()) {
  seedOfficialPlugins(database);
  ensureUserMemberships(database);
}

export function writeAuditLog(actorUserId: string | null, action: string, targetType: string, targetId: string | null, metadata: unknown = {}) {
  getDatabase().prepare(`
    INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), actorUserId, action, targetType, targetId, JSON.stringify(metadata), new Date().toISOString());
}
