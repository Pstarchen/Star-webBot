import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "starbot-hosted-plugin-test-"));
const databasePath = path.join(temporaryDirectory, "starbot.db");

let databaseModule: typeof import("@/lib/database");
let cryptoModule: typeof import("@/lib/crypto-vault");
let packageModule: typeof import("@/lib/hosted-plugin-package");
let runtimeModule: typeof import("@/lib/hosted-plugin-runtime");
let serviceModule: typeof import("@/lib/hosted-plugin-service");
let sessionModule: typeof import("@/lib/session");

function pluginPackage(input: {
  id?: string;
  version?: string;
  permissions?: string[];
  code?: string;
  configSchema?: unknown[];
}) {
  const manifest = {
    schemaVersion: 1,
    id: input.id || "test-counter",
    name: input.id === "denied-storage" ? "越权存储测试" : "计数器测试插件",
    version: input.version || "1.0.0",
    description: "用于验证 StarBot 托管插件导入、配置和隔离执行链路。",
    author: "测试开发者",
    category: "开发测试",
    tags: ["测试"],
    entry: "index.js",
    events: ["C2C_MESSAGE_CREATE"],
    permissions: input.permissions || ["storage:kv", "log:write"],
    commands: [{ name: "计数", description: "累计收到的消息事件" }],
    configSchema: input.configSchema || [{ key: "step", label: "步长", type: "number", required: true, default: 1, min: 1, max: 10 }],
  };
  const code = input.code || `StarBot.definePlugin({
    onEvent(event, sdk) {
      sdk.kv.set("count", sdk.kv.get("count", 0) + sdk.config.step);
      sdk.log.info("count updated", event.type);
    }
  });`;
  return zipSync({
    "starbot.plugin.json": strToU8(JSON.stringify(manifest)),
    "index.js": strToU8(code),
    "README.md": strToU8("# Test plugin"),
  });
}

beforeAll(async () => {
  process.env.DATABASE_PATH = databasePath;
  process.env.BOOTSTRAP_ADMIN_EMAIL = "hosted-admin@test.local";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "hosted-admin-password";
  [databaseModule, cryptoModule, packageModule, runtimeModule, serviceModule, sessionModule] = await Promise.all([
    import("@/lib/database"),
    import("@/lib/crypto-vault"),
    import("@/lib/hosted-plugin-package"),
    import("@/lib/hosted-plugin-runtime"),
    import("@/lib/hosted-plugin-service"),
    import("@/lib/session"),
  ]);
  databaseModule.getDatabase();
});

afterAll(() => {
  const state = globalThis as typeof globalThis & { __starbotDatabase?: { close(): void } };
  state.__starbotDatabase?.close();
  delete state.__starbotDatabase;
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("hosted plugin packages", () => {
  it("validates a versioned ZIP package and its manifest", () => {
    const parsed = packageModule.parseHostedPluginPackage(pluginPackage({}));
    expect(parsed.manifest).toMatchObject({ id: "test-counter", version: "1.0.0", entry: "index.js" });
    expect(parsed.validation).toMatchObject({ fileCount: 3, scanner: "quickjs-isolated" });
    expect(parsed.packageSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects archive path traversal and inflated package bombs", () => {
    const traversal = zipSync({ "../starbot.plugin.json": strToU8("{}") });
    expect(() => packageModule.parseHostedPluginPackage(traversal)).toThrow("PLUGIN_PACKAGE_PATH_INVALID");
    const oversized = zipSync({ "starbot.plugin.json": strToU8("{}"), "large.bin": new Uint8Array(1024 * 1024 + 1) }, { level: 9 });
    expect(() => packageModule.parseHostedPluginPackage(oversized)).toThrow("PLUGIN_PACKAGE_FILE_TOO_LARGE");
    expect(() => packageModule.parseHostedPluginPackage(strToU8("not-a-zip"))).toThrow("PLUGIN_PACKAGE_INVALID");
  });
});

describe("hosted plugin runtime", () => {
  it("exposes only the structured SDK inside QuickJS", async () => {
    const result = await runtimeModule.executeHostedPlugin({
      code: `StarBot.definePlugin({ onEvent(event, sdk) {
        sdk.reply.text([typeof process, typeof require, typeof fetch, event.type].join(":"));
        sdk.stopPropagation();
      }});`,
      event: { type: "C2C_MESSAGE_CREATE", data: {} },
      config: {},
      kv: {},
    });
    expect(result.actions).toEqual([{ kind: "reply", format: "text", content: "undefined:undefined:undefined:C2C_MESSAGE_CREATE" }]);
    expect(result.stopPropagation).toBe(true);
  });

  it("interrupts CPU-bound plugin code", async () => {
    await expect(runtimeModule.validateHostedPluginCode("while (true) {}"))
      .rejects.toThrow("PLUGIN_EXECUTION_TIMEOUT");
  });

  it("runs the daily check-in example with persistent user state", async () => {
    const code = fs.readFileSync(path.resolve(import.meta.dirname, "../examples/checkin-plugin/index.js"), "utf8");
    const config = { checkinCommand: "签到", statusCommand: "我的签到", successMessage: "签到成功" };
    const event = { type: "C2C_MESSAGE_CREATE", data: { content: "签到", author: { user_openid: "test-user" } } };
    const first = await runtimeModule.executeHostedPlugin({ code, event, config, kv: {} });
    const storedRecord = first.actions.find((action) => action.kind === "kv_set");

    expect(first.actions).toContainEqual({ kind: "reply", format: "text", content: "签到成功，这是第 1 天。" });
    expect(storedRecord).toMatchObject({ kind: "kv_set", key: "checkin:test-user", value: { count: 1 } });

    const kv = { "checkin:test-user": storedRecord?.kind === "kv_set" ? storedRecord.value : null };
    const repeated = await runtimeModule.executeHostedPlugin({ code, event, config, kv });
    expect(repeated.actions).toEqual([{ kind: "reply", format: "text", content: "今天已经签到过了，累计 1 天。" }]);

    const status = await runtimeModule.executeHostedPlugin({
      code,
      event: { ...event, data: { ...event.data, content: "我的签到" } },
      config,
      kv,
    });
    expect(status.actions[0]).toMatchObject({ kind: "reply", format: "text", content: expect.stringContaining("累计签到 1 天") });
  });
});

describe("hosted plugin lifecycle", () => {
  it("imports, installs, configures, executes and publishes a plugin", async () => {
    const user = sessionModule.registerUser({ name: "插件作者", email: "plugin-author@example.com", password: "strong-password" });
    databaseModule.getDatabase().prepare("UPDATE membership_plans SET plugin_quota = 20 WHERE id = 'free'").run();
    const botId = randomUUID();
    const now = new Date().toISOString();
    databaseModule.getDatabase().prepare(`
      INSERT INTO bots (id, user_id, name, app_id, client_secret_cipher, environment, intents, status, created_at, updated_at)
      VALUES (?, ?, 'Plugin Test Bot', ?, ?, 'sandbox', 0, 'offline', ?, ?)
    `).run(botId, user.id, `plugin-test-${botId}`, cryptoModule.encryptSecret("not-used-client-secret"), now, now);

    const imported = await serviceModule.importPluginPackage(user, pluginPackage({
      configSchema: [{ key: "step", label: "步长", type: "number", required: true, min: 1, max: 10 }],
    }));
    const installed = serviceModule.installPlugin(user, { projectId: imported.projectId, versionId: imported.versionId, botId, priority: 20 });
    databaseModule.getDatabase().prepare("DELETE FROM plugin_config_values WHERE installation_id = ?").run(installed.installationId);
    expect(() => serviceModule.updatePluginInstallation(user, installed.installationId, { enabled: true })).toThrow("PLUGIN_CONFIG_REQUIRED:step");
    serviceModule.updatePluginInstallation(user, installed.installationId, { enabled: true, config: { step: 3 } });

    await expect(serviceModule.dispatchHostedPlugins(botId, "C2C_MESSAGE_CREATE", { id: "hosted-event-1", content: "hello" }))
      .resolves.toEqual({ executed: 1, stopped: false });
    expect(databaseModule.getDatabase().prepare("SELECT value_json FROM plugin_kv WHERE installation_id = ? AND key = 'count'").get(installed.installationId))
      .toEqual({ value_json: "3" });
    expect(databaseModule.getDatabase().prepare("SELECT status, action_count FROM plugin_runs WHERE installation_id = ?").get(installed.installationId))
      .toEqual({ status: "success", action_count: 1 });

    const review = serviceModule.requestPluginReview(user, imported.projectId, imported.versionId);
    expect(() => serviceModule.requestPluginReview(user, imported.projectId, imported.versionId)).toThrow("PLUGIN_REVIEW_ALREADY_PENDING");
    const admin = sessionModule.authenticate("hosted-admin@test.local", "hosted-admin-password");
    expect(admin).not.toBeNull();
    serviceModule.reviewPlugin(admin!, review.reviewId, { approved: true, featured: true });
    const center = serviceModule.listPluginCenter(user);
    expect(center.installations[0]).toMatchObject({ id: installed.installationId, enabled: true, priority: 20, config: { step: 3 } });
    expect(center.marketplace.find((plugin) => plugin.id === imported.projectId)).toMatchObject({ featured: true, owned: true });
  });

  it("records permission violations and automatically disables repeated failures", async () => {
    const user = sessionModule.authenticate("plugin-author@example.com", "strong-password");
    expect(user).not.toBeNull();
    const bot = databaseModule.getDatabase().prepare("SELECT id FROM bots WHERE user_id = ? LIMIT 1").get(user!.id) as { id: string };
    const imported = await serviceModule.importPluginPackage(user!, pluginPackage({
      id: "denied-storage",
      permissions: [],
      code: "StarBot.definePlugin({ onEvent(event, sdk) { sdk.kv.set('forbidden', true); } });",
      configSchema: [],
    }));
    const installed = serviceModule.installPlugin(user!, { projectId: imported.projectId, botId: bot.id });
    serviceModule.updatePluginInstallation(user!, installed.installationId, { enabled: true });
    for (let index = 0; index < serviceModule.hostedPluginLimits.autoDisableFailures; index += 1) {
      await serviceModule.dispatchHostedPlugins(bot.id, "C2C_MESSAGE_CREATE", { id: `denied-${index}` });
    }
    expect(databaseModule.getDatabase().prepare("SELECT enabled, failure_count, last_error FROM plugin_installations WHERE id = ?").get(installed.installationId))
      .toEqual({ enabled: 0, failure_count: 5, last_error: "PLUGIN_PERMISSION_DENIED:storage:kv" });
    expect(databaseModule.getDatabase().prepare("SELECT COUNT(*) AS count FROM plugin_kv WHERE installation_id = ?").get(installed.installationId))
      .toEqual({ count: 0 });
  });
});
