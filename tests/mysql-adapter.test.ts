import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const mysqlEnabled = process.env.MYSQL_TEST_DATABASE === "true";
const mysqlDescribe = mysqlEnabled ? describe : describe.skip;

let databaseModule: typeof import("@/lib/database");
let eventRetentionModule: typeof import("@/lib/event-retention");
let gatewayCoordinationModule: typeof import("@/lib/gateway-coordination");
let hostedPluginServiceModule: typeof import("@/lib/hosted-plugin-service");
let sessionModule: typeof import("@/lib/session");
let systemSettingsModule: typeof import("@/lib/system-settings-service");
let configurationDirectory: string;
const installationLogoBytes = Buffer.alloc(5 * 1024 * 1024, 0x4c);
const installationFaviconBytes = Buffer.alloc(5 * 1024 * 1024, 0x46);

mysqlDescribe("MySQL database adapter", () => {
  beforeAll(async () => {
    configurationDirectory = mkdtempSync(path.join(tmpdir(), "starbot-mysql-install-"));
    delete process.env.DATABASE_PROVIDER;
    delete process.env.BOOTSTRAP_ADMIN_EMAIL;
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    process.env.DATABASE_PATH = path.join(configurationDirectory, "starbot.db");
    [databaseModule, eventRetentionModule, gatewayCoordinationModule, hostedPluginServiceModule, sessionModule, systemSettingsModule] = await Promise.all([
      import("@/lib/database"),
      import("@/lib/event-retention"),
      import("@/lib/gateway-coordination"),
      import("@/lib/hosted-plugin-service"),
      import("@/lib/session"),
      import("@/lib/system-settings-service"),
    ]);

    const installation = databaseModule.beginDatabaseInstallation({
      provider: "mysql",
      host: process.env.MYSQL_HOST || "127.0.0.1",
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || "",
      password: process.env.MYSQL_PASSWORD || "",
      database: process.env.MYSQL_DATABASE || "",
      ssl: process.env.MYSQL_SSL === "true",
    });
    try {
      installation.persist();
      systemSettingsModule.completeInstallation({
        siteName: "MySQL Test",
        siteTagline: "Installation flow",
        siteDescription: "Validates the complete MySQL installation flow.",
        adminName: "MySQL Admin",
        adminEmail: "mysql-admin@test.local",
        adminPassword: "mysql-admin-password",
        logo: { mimeType: "image/png", bytes: installationLogoBytes },
        favicon: { mimeType: "image/x-icon", bytes: installationFaviconBytes },
      });
      installation.commit();
    } catch (error) {
      installation.rollback();
      throw error;
    }
  });

  afterAll(() => {
    const state = globalThis as typeof globalThis & { __starbotDatabase?: { close(): void }; __starbotDatabaseConfigurationKey?: string };
    state.__starbotDatabase?.close();
    delete state.__starbotDatabase;
    delete state.__starbotDatabaseConfigurationKey;
    if (configurationDirectory) rmSync(configurationDirectory, { recursive: true, force: true });
  });

  it("completes installation through a persisted MySQL configuration", () => {
    const database = databaseModule.getDatabase();
    expect(database.prepare("SELECT 1 AS connected").get()).toEqual({ connected: 1 });
    expect(database.prepare("SELECT id FROM membership_plans ORDER BY id").all()).toEqual([{ id: "free" }, { id: "pro" }, { id: "team" }]);
    expect(database.prepare("SELECT site_logo_mime, site_logo_blob, site_favicon_mime, site_favicon_blob FROM system_settings WHERE id = 1").get()).toEqual({
      site_logo_mime: "image/png",
      site_logo_blob: null,
      site_favicon_mime: "image/x-icon",
      site_favicon_blob: null,
    });
    const storedLogo = systemSettingsModule.getSiteAsset("logo");
    const storedFavicon = systemSettingsModule.getSiteAsset("favicon");
    expect(storedLogo.mime).toBe("image/png");
    expect(storedLogo.data?.equals(installationLogoBytes)).toBe(true);
    expect(storedFavicon.mime).toBe("image/x-icon");
    expect(storedFavicon.data?.equals(installationFaviconBytes)).toBe(true);
    expect(database.prepare("SELECT COUNT(*) AS count FROM site_asset_chunks WHERE kind = 'logo'").get()).toEqual({ count: 27 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM site_asset_chunks WHERE kind = 'favicon'").get()).toEqual({ count: 27 });
    expect(sessionModule.authenticate("mysql-admin@test.local", "mysql-admin-password")).toMatchObject({ role: "admin", membershipPlan: "pro" });
  }, 60_000);

  it("uses portable event retention and gateway lease upserts", () => {
    const user = sessionModule.registerUser({ name: "MySQL User", email: `mysql-user-${randomUUID()}@example.com`, password: "strong-password" });
    const database = databaseModule.getDatabase();
    const botId = randomUUID();
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO bots (id, user_id, name, app_id, client_secret_cipher, environment, connection_mode, intents, status, auto_connect, created_at, updated_at)
      VALUES (?, ?, 'MySQL Bot', ?, 'cipher', 'sandbox', 'websocket', 0, 'offline', 1, ?, ?)
    `).run(botId, user.id, `mysql-app-${botId}`, now, now);
    database.prepare(`
      INSERT INTO event_logs (id, bot_id, event_type, scene, status, latency_ms, content, payload_json, trace_id, received_at)
      VALUES (?, ?, 'GROUP_MESSAGE_CREATE', '群聊', 'success', 0, '', '{}', NULL, ?)
    `).run(randomUUID(), botId, new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString());

    expect(eventRetentionModule.pruneExpiredEvents()).toBeGreaterThanOrEqual(1);
    expect(database.prepare("SELECT COUNT(*) AS count FROM event_logs WHERE bot_id = ?").get(botId)).toEqual({ count: 0 });
    expect(gatewayCoordinationModule.acquireGatewayLease(botId, Date.now())).toBe(true);
    expect(gatewayCoordinationModule.renewGatewayLease(botId, Date.now())).toBe(true);
  });

  it("installs private plugins with default config and persists plugin KV", async () => {
    const admin = sessionModule.authenticate("mysql-admin@test.local", "mysql-admin-password");
    expect(admin).not.toBeNull();
    const database = databaseModule.getDatabase();
    const botId = randomUUID();
    const projectId = randomUUID();
    const versionId = randomUUID();
    const now = new Date().toISOString();
    const manifest = {
      schemaVersion: 1,
      id: `mysql-default-config-${projectId}`,
      name: "MySQL Default Config Plugin",
      version: "1.0.0",
      description: "Validates MySQL plugin config and KV queries.",
      author: "StarBot Tests",
      category: "Testing",
      tags: ["mysql"],
      entry: "index.js",
      events: ["C2C_MESSAGE_CREATE"],
      permissions: ["storage:kv"],
      commands: [],
      configSchema: [{ key: "step", label: "Step", type: "number", required: true, default: 2, min: 1, max: 10 }],
    };
    database.prepare(`
      INSERT INTO bots (id, user_id, name, app_id, client_secret_cipher, environment, connection_mode, intents, status, auto_connect, created_at, updated_at)
      VALUES (?, ?, 'MySQL Plugin Bot', ?, 'cipher', 'sandbox', 'websocket', 0, 'offline', 0, ?, ?)
    `).run(botId, admin!.id, `mysql-plugin-${botId}`, now, now);
    database.prepare(`
      INSERT INTO plugin_projects
        (id, owner_user_id, slug, name, description, author, category, tags_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'private', ?, ?)
    `).run(projectId, admin!.id, manifest.id, manifest.name, manifest.description, manifest.author, manifest.category, JSON.stringify(manifest.tags), now, now);
    database.prepare(`
      INSERT INTO plugin_versions
        (id, project_id, version, manifest_json, entry_code, readme, package_sha256, package_size, validation_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, 1, '{}', 'active', ?)
    `).run(versionId, projectId, manifest.version, JSON.stringify(manifest), "StarBot.definePlugin({ onEvent(event, sdk) { sdk.kv.set('count', sdk.config.step); } });", "0".repeat(64), now);

    const installed = hostedPluginServiceModule.installPlugin(admin!, { projectId, versionId, botId });
    expect(database.prepare("SELECT value_json FROM plugin_config_values WHERE installation_id = ? AND `key` = 'step'").get(installed.installationId))
      .toEqual({ value_json: "2" });
    expect(hostedPluginServiceModule.listPluginCenter(admin!).installations.find((installation) => installation.id === installed.installationId)?.config)
      .toEqual({ step: 2 });

    hostedPluginServiceModule.updatePluginInstallation(admin!, installed.installationId, { enabled: true, config: { step: 3 } });
    await expect(hostedPluginServiceModule.dispatchHostedPlugins(botId, "C2C_MESSAGE_CREATE", { id: randomUUID() }))
      .resolves.toEqual({ executed: 1, stopped: false });
    expect(database.prepare("SELECT value_json FROM plugin_kv WHERE installation_id = ? AND `key` = 'count'").get(installed.installationId))
      .toEqual({ value_json: "3" });
  });

  it("recovers when a previous initialization stopped after creating users", () => {
    const database = databaseModule.getDatabase();
    const usersBeforeRecovery = database.prepare("SELECT id, email FROM users ORDER BY id").all();
    const tables = database.prepare(`
      SELECT TABLE_NAME AS table_name FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
    `).all() as Array<{ table_name: string }>;
    database.exec("SET FOREIGN_KEY_CHECKS = 0");
    try {
      for (const { table_name: tableName } of tables) {
        if (tableName === "users") continue;
        if (!/^[a-z0-9_]+$/.test(tableName)) throw new Error("MYSQL_TEST_TABLE_NAME_INVALID");
        database.exec(`DROP TABLE \`${tableName}\``);
      }
    } finally {
      database.exec("SET FOREIGN_KEY_CHECKS = 1");
    }
    const state = globalThis as typeof globalThis & { __starbotDatabase?: { close(): void }; __starbotDatabaseConfigurationKey?: string };
    state.__starbotDatabase?.close();
    delete state.__starbotDatabase;
    delete state.__starbotDatabaseConfigurationKey;

    const recovered = databaseModule.getDatabase();
    expect(recovered.prepare("SELECT id, email FROM users ORDER BY id").all()).toEqual(usersBeforeRecovery);
    expect(recovered.prepare(`
      SELECT id FROM schema_migrations
      WHERE id IN ('20260812_sdk_application_schema', '20260813_system_settings_and_billing')
      ORDER BY id
    `).all()).toEqual([
      { id: "20260812_sdk_application_schema" },
      { id: "20260813_system_settings_and_billing" },
    ]);
    expect(sessionModule.authenticate("mysql-admin@test.local", "mysql-admin-password")).toMatchObject({ role: "admin" });
  });
});
