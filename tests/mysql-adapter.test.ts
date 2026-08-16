import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const mysqlEnabled = process.env.MYSQL_TEST_DATABASE === "true";
const mysqlDescribe = mysqlEnabled ? describe : describe.skip;

let databaseModule: typeof import("@/lib/database");
let eventRetentionModule: typeof import("@/lib/event-retention");
let gatewayCoordinationModule: typeof import("@/lib/gateway-coordination");
let sessionModule: typeof import("@/lib/session");

mysqlDescribe("MySQL database adapter", () => {
  beforeAll(async () => {
    process.env.DATABASE_PROVIDER = "mysql";
    process.env.BOOTSTRAP_ADMIN_EMAIL = "mysql-admin@test.local";
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "mysql-admin-password";
    [databaseModule, eventRetentionModule, gatewayCoordinationModule, sessionModule] = await Promise.all([
      import("@/lib/database"),
      import("@/lib/event-retention"),
      import("@/lib/gateway-coordination"),
      import("@/lib/session"),
    ]);
    databaseModule.getDatabase();
  });

  afterAll(() => {
    const state = globalThis as typeof globalThis & { __starbotDatabase?: { close(): void }; __starbotDatabaseConfigurationKey?: string };
    state.__starbotDatabase?.close();
    delete state.__starbotDatabase;
    delete state.__starbotDatabaseConfigurationKey;
  });

  it("creates the full schema and bootstrap membership", () => {
    const database = databaseModule.getDatabase();
    expect(database.prepare("SELECT 1 AS connected").get()).toEqual({ connected: 1 });
    expect(database.prepare("SELECT id FROM membership_plans ORDER BY id").all()).toEqual([{ id: "free" }, { id: "pro" }, { id: "team" }]);
    expect(sessionModule.authenticate("mysql-admin@test.local", "mysql-admin-password")).toMatchObject({ role: "admin", membershipPlan: "pro" });
  });

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

  it("recovers when a previous initialization stopped after creating users", () => {
    const database = databaseModule.getDatabase();
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
    expect(recovered.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 2 });
    expect(recovered.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({ count: 2 });
    expect(sessionModule.authenticate("mysql-admin@test.local", "mysql-admin-password")).toMatchObject({ role: "admin" });
  });
});
