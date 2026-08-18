import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import nextConfig from "../next.config";

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
  events?: string[];
  code?: string;
  configSchema?: unknown[];
  configPage?: { entry: string; height: number };
  configPageHtml?: string;
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
    events: input.events || ["C2C_MESSAGE_CREATE"],
    permissions: input.permissions || ["storage:kv", "log:write"],
    commands: [{ name: "计数", description: "累计收到的消息事件" }],
    configSchema: input.configSchema || [{ key: "step", label: "步长", type: "number", required: true, default: 1, min: 1, max: 10 }],
    ...(input.configPage ? { configPage: input.configPage } : {}),
  };
  const code = input.code || `StarBot.definePlugin({
    onEvent(event, sdk) {
      sdk.kv.set("count", sdk.kv.get("count", 0) + sdk.config.step);
      sdk.log.info("count updated", event.type);
    }
  });`;
  const files: Record<string, Uint8Array> = {
    "starbot.plugin.json": strToU8(JSON.stringify(manifest)),
    "index.js": strToU8(code),
    "README.md": strToU8("# Test plugin"),
  };
  if (input.configPage && input.configPageHtml !== undefined) files[input.configPage.entry] = strToU8(input.configPageHtml);
  return zipSync(files);
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

  it("accepts the wildcard event subscription", () => {
    const parsed = packageModule.parseHostedPluginPackage(pluginPackage({ events: ["*"] }));
    expect(parsed.manifest.events).toEqual(["*"]);
  });

  it("accepts the controlled HTTP permission", () => {
    const parsed = packageModule.parseHostedPluginPackage(pluginPackage({ permissions: ["http:request"] }));
    expect(parsed.manifest.permissions).toEqual(["http:request"]);
  });

  it("loads a declared custom configuration page and rejects a missing page", () => {
    const configPage = { entry: "config.html", height: 880 };
    const parsed = packageModule.parseHostedPluginPackage(pluginPackage({
      configPage,
      configPageHtml: "<main><h1>插件配置</h1></main>",
    }));
    expect(parsed.manifest.configPage).toEqual(configPage);
    expect(parsed.configPageHtml).toContain("插件配置");
    expect(() => packageModule.parseHostedPluginPackage(pluginPackage({ configPage })))
      .toThrow("PLUGIN_CONFIG_PAGE_MISSING");
  });

  it("validates api-list and reply-list configuration values", () => {
    const parsed = packageModule.parseHostedPluginPackage(pluginPackage({
      configSchema: [
        { key: "apis", label: "API", type: "api-list", required: true, default: [] },
        { key: "rules", label: "回复", type: "reply-list", required: true, default: [] },
      ],
    }));
    const config = packageModule.validatePluginConfig(parsed.manifest, {
      apis: [{ id: "weather", name: "天气", method: "GET", responseMode: "media", responseTemplate: "温度：{{api.weather}}", chainToApiId: "summary", url: "https://api.example.com/weather", headers: {} }],
      rules: [{ id: "weatherRule", name: "天气回复", prefix: "天气", match: "exact", conditions: { botIds: ["bot-1"] }, apis: ["weather"], reply: { text: "晴", media: [] } }],
    });
    expect(config.apis).toEqual([expect.objectContaining({ id: "weather", responseMode: "media", chainToApiId: "summary" })]);
    expect(config.rules).toEqual([expect.objectContaining({ conditions: expect.objectContaining({ botIds: ["bot-1"] }) })]);
    expect(() => packageModule.validatePluginConfig(parsed.manifest, {
      apis: [{ id: "invalid id", name: "天气", method: "GET", url: "https://api.example.com", headers: {} }],
      rules: [],
    })).toThrow("PLUGIN_CONFIG_TYPE:apis");
  });
});

describe("hosted plugin production bundling", () => {
  it("loads QuickJS as a native server dependency", () => {
    expect(nextConfig.serverExternalPackages).toContain("quickjs-emscripten");
  });
});

describe("hosted plugin runtime", () => {
  it("validates a plugin definition", async () => {
    await expect(runtimeModule.validateHostedPluginCode(
      "StarBot.definePlugin({ onEvent() {} });",
    )).resolves.toBeUndefined();
  });

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

  it("exposes authenticated media relay without sending source headers to QQ", async () => {
    const requests: unknown[] = [];
    const result = await runtimeModule.executeHostedPlugin({
      code: `StarBot.definePlugin({ async onEvent(event, sdk) {
        const uploaded = await sdk.qq.uploadMediaFromUrl("group", "group-openid", 1, "https://api.example.com/image", { Authorization: "Bearer test-key" });
        sdk.reply.text(uploaded.body.file_info);
      } });`,
      event: { type: "GROUP_MESSAGE_CREATE", data: {} },
      config: {},
      kv: {},
      qqMediaUpload: async (request) => {
        requests.push(request);
        return { body: { file_info: "relay-file-info" }, traceId: "trace-relay" };
      },
      qqRequest: async (_method, _path, body) => {
        throw new Error(`unexpected QQ request: ${JSON.stringify(body)}`);
      },
    });

    expect(result.actions).toEqual([{ kind: "reply", format: "text", content: "relay-file-info" }]);
    expect(requests).toEqual([{
      targetType: "group",
      targetOpenid: "group-openid",
      fileType: 1,
      url: "https://api.example.com/image",
      headers: { Authorization: "Bearer test-key" },
    }]);
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

  it("runs the group moderation example with role and mention enforcement", async () => {
    const code = fs.readFileSync(path.resolve(import.meta.dirname, "../examples/group-moderation-plugin/index.js"), "utf8");
    const config = {
      muteCommand: "/禁言",
      unmuteCommand: "/解禁",
      statusCommand: "/禁言状态",
      defaultDurationMinutes: 10,
      maxDurationMinutes: 1440,
      allowGroupAdmins: true,
    };
    const event = {
      type: "GROUP_AT_MESSAGE_CREATE",
      data: {
        content: "/禁言 30s",
        group_openid: "group-openid",
        author: { member_openid: "admin-openid", member_role: "admin" },
        mentions: [{ member_openid: "member-openid", member_role: "member", username: "测试成员", bot: false }],
      },
    };
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    const muted = await runtimeModule.executeHostedPlugin({
      code,
      event,
      config,
      kv: {},
      qqRequest: async (method, requestPath, body) => {
        requests.push({ method, path: requestPath, body });
        return { body: {}, traceId: "trace-mute" };
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: "POST", path: "/v2/groups/group-openid/restrict_chat_setting" });
    const muteBody = requests[0].body as { members: Array<{ op: string; member_openid: string; mute_expire_at: string }> };
    expect(muteBody.members[0]).toMatchObject({ op: "add", member_openid: "member-openid" });
    expect(Date.parse(muteBody.members[0].mute_expire_at)).toBeGreaterThan(Date.now() + 20_000);
    expect(muted.actions).toContainEqual({ kind: "reply", format: "text", content: "已禁言 测试成员 30 秒。" });

    const denied = await runtimeModule.executeHostedPlugin({
      code,
      event: { ...event, data: { ...event.data, author: { member_openid: "regular-openid", member_role: "member" } } },
      config,
      kv: {},
      qqRequest: async () => { throw new Error("NETWORK_MUST_NOT_RUN"); },
    });
    expect(denied.qqRequestCount).toBe(0);
    expect(denied.actions).toEqual([{ kind: "reply", format: "text", content: "仅群主或已获授权的群管理员可以执行该命令。" }]);

    const protectedTarget = await runtimeModule.executeHostedPlugin({
      code,
      event: { ...event, data: { ...event.data, mentions: [{ member_openid: "owner-openid", member_role: "owner", username: "群主" }] } },
      config,
      kv: {},
      qqRequest: async () => { throw new Error("NETWORK_MUST_NOT_RUN"); },
    });
    expect(protectedTarget.qqRequestCount).toBe(0);
    expect(protectedTarget.actions).toEqual([{ kind: "reply", format: "text", content: "只能操作普通群成员，不能操作群主、管理员或机器人。" }]);

    requests.length = 0;
    const unmuted = await runtimeModule.executeHostedPlugin({
      code,
      event: { ...event, data: { ...event.data, content: "/解禁" } },
      config,
      kv: {},
      qqRequest: async (method, requestPath, body) => {
        requests.push({ method, path: requestPath, body });
        return { body: {}, traceId: "trace-unmute" };
      },
    });
    expect(requests[0]).toEqual({
      method: "POST",
      path: "/v2/groups/group-openid/restrict_chat_setting",
      body: { members: [{ op: "del", member_openid: "member-openid", mute_expire_at: "" }] },
    });
    expect(unmuted.actions).toContainEqual({ kind: "reply", format: "text", content: "已解除 测试成员 的禁言。" });

    requests.length = 0;
    const status = await runtimeModule.executeHostedPlugin({
      code,
      event: { ...event, data: { ...event.data, content: "/禁言状态", mentions: [] } },
      config,
      kv: {},
      qqRequest: async (method, requestPath, body) => {
        requests.push({ method, path: requestPath, body });
        return { body: { members: [{ member_openid: "muted-member" }] }, traceId: "trace-status" };
      },
    });
    expect(requests).toEqual([{ method: "GET", path: "/v2/groups/group-openid/restrict_chat_setting", body: undefined }]);
    expect(status.actions).toContainEqual({ kind: "reply", format: "text", content: "当前群有 1 名成员处于禁言状态。" });

    const invalidDuration = await runtimeModule.executeHostedPlugin({
      code,
      event: { ...event, data: { ...event.data, content: "/禁言 很久" } },
      config,
      kv: {},
      qqRequest: async () => { throw new Error("NETWORK_MUST_NOT_RUN"); },
    });
    expect(invalidDuration.qqRequestCount).toBe(0);
    expect(invalidDuration.actions).toEqual([{ kind: "reply", format: "text", content: "禁言时长格式无效，请使用 30s、10m、2h 或 1d。" }]);
  });

  it("lets async plugins consume QQ OpenAPI responses", async () => {
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    const result = await runtimeModule.executeHostedPlugin({
      code: `StarBot.definePlugin({ async onEvent(event, sdk) {
        const profile = await sdk.qq.getBotProfile();
        const groups = await sdk.qq.callEndpoint("listBotGuilds", {}, undefined, { limit: 10 });
        sdk.reply.text(profile.body.username + ":" + groups.body.length + ":" + profile.traceId);
      }});`,
      event: { type: "C2C_MESSAGE_CREATE", data: {} },
      config: {},
      kv: {},
      qqRequest: async (method, path, body) => {
        requests.push({ method, path, body });
        return path === "/users/@me"
          ? { body: { username: "异步测试机器人" }, traceId: "trace-profile" }
          : { body: [{ id: "guild-1" }], traceId: "trace-guilds" };
      },
    });

    expect(requests).toEqual([
      { method: "GET", path: "/users/@me", body: undefined },
      { method: "GET", path: "/users/@me/guilds?limit=10", body: undefined },
    ]);
    expect(result.qqRequestCount).toBe(2);
    expect(result.actions).toEqual([{ kind: "reply", format: "text", content: "异步测试机器人:1:trace-profile" }]);
  });

  it("exposes channel and channel DMS message helpers", async () => {
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    const result = await runtimeModule.executeHostedPlugin({
      code: `StarBot.definePlugin({ async onEvent(event, sdk) {
        await sdk.qq.sendChannel("channel id", { content: "频道消息" });
        await sdk.qq.sendDms("guild id", { content: "频道私信" });
      }});`,
      event: { type: "AT_MESSAGE_CREATE", data: {} },
      config: {},
      kv: {},
      qqRequest: async (method, requestPath, body) => {
        requests.push({ method, path: requestPath, body });
        return { body: { id: "sent" }, traceId: "trace-channel" };
      },
    });

    expect(requests).toEqual([
      { method: "POST", path: "/channels/channel%20id/messages", body: { content: "频道消息" } },
      { method: "POST", path: "/dms/guild%20id/messages", body: { content: "频道私信" } },
    ]);
    expect(result.qqRequestCount).toBe(2);
  });

  it("lets async plugins consume controlled HTTP responses", async () => {
    const requests: Array<{ url: string; method?: string; body?: unknown }> = [];
    const result = await runtimeModule.executeHostedPlugin({
      code: `StarBot.definePlugin({ async onEvent(event, sdk) {
        const response = await sdk.http.request("https://api.example.com/weather", { method: "POST", body: { city: "深圳" } });
        sdk.reply.text(response.body.city + ":" + response.body.temperature);
      }});`,
      event: { type: "C2C_MESSAGE_CREATE", data: {} },
      config: {},
      kv: {},
      httpRequest: async (request) => {
        requests.push(request);
        return { url: request.url, status: 200, ok: true, headers: {}, body: { city: "深圳", temperature: 28 } };
      },
    });

    expect(requests).toEqual([{ url: "https://api.example.com/weather", method: "POST", body: { city: "深圳" } }]);
    expect(result.httpRequestCount).toBe(1);
    expect(result.actions).toEqual([{ kind: "reply", format: "text", content: "深圳:28" }]);
  });

  it("passes media response mode through the sandbox HTTP bridge", async () => {
    const requests: Array<{ responseMode?: string; timeoutMs?: number }> = [];
    const result = await runtimeModule.executeHostedPlugin({
      code: `StarBot.definePlugin({ async onEvent(event, sdk) {
        const response = await sdk.http.request("https://cdn.example.com/video.mp4", { responseMode: "media", timeoutMs: 4500 });
        sdk.reply.text(response.url);
      }});`,
      event: { type: "C2C_MESSAGE_CREATE", data: {} },
      config: {},
      kv: {},
      httpRequest: async (request) => {
        requests.push(request);
        return { url: request.url, status: 200, ok: true, headers: { "content-type": "video/mp4" }, body: "" };
      },
    });

    expect(requests).toEqual([{ url: "https://cdn.example.com/video.mp4", method: "GET", responseMode: "media", timeoutMs: 4500 }]);
    expect(result.actions).toEqual([{ kind: "reply", format: "text", content: "https://cdn.example.com/video.mp4" }]);
  });

  it("lets plugins handle HTTP permission errors", async () => {
    const result = await runtimeModule.executeHostedPlugin({
      code: `StarBot.definePlugin({ async onEvent(event, sdk) {
        try { await sdk.http.request("https://api.example.com/"); }
        catch (error) { sdk.reply.text(error.message); }
      }});`,
      event: { type: "C2C_MESSAGE_CREATE", data: {} },
      config: {},
      kv: {},
      httpRequest: async () => { throw new Error("PLUGIN_PERMISSION_DENIED:http:request"); },
    });
    expect(result.actions).toEqual([{ kind: "reply", format: "text", content: "PLUGIN_PERMISSION_DENIED:http:request" }]);
  });

  it("lets plugins handle observed QQ errors and rejects unobserved failures", async () => {
    const qqRequest = async () => { throw new Error("QQ_WRITE_DENIED"); };
    const handled = await runtimeModule.executeHostedPlugin({
      code: `StarBot.definePlugin({ async onEvent(event, sdk) {
        try { await sdk.qq.getBotProfile(); }
        catch (error) { sdk.reply.text(error.message); }
      }});`,
      event: { type: "C2C_MESSAGE_CREATE", data: {} },
      config: {},
      kv: {},
      qqRequest,
    });
    expect(handled.actions).toEqual([{ kind: "reply", format: "text", content: "QQ_WRITE_DENIED" }]);

    await expect(runtimeModule.executeHostedPlugin({
      code: "StarBot.definePlugin({ onEvent(event, sdk) { sdk.qq.getBotProfile(); } });",
      event: { type: "C2C_MESSAGE_CREATE", data: {} },
      config: {},
      kv: {},
      qqRequest,
    })).rejects.toThrow("QQ_WRITE_DENIED");

    await expect(runtimeModule.executeHostedPlugin({
      code: "StarBot.definePlugin({ async onEvent(event, sdk) { sdk.qq.getBotProfile(); } });",
      event: { type: "C2C_MESSAGE_CREATE", data: {} },
      config: {},
      kv: {},
      qqRequest,
    })).rejects.toThrow("QQ_WRITE_DENIED");
  });

  it("interrupts CPU-bound continuations after QQ responses", async () => {
    const startedAt = Date.now();
    await expect(runtimeModule.executeHostedPlugin({
      code: "StarBot.definePlugin({ async onEvent(event, sdk) { await sdk.qq.getBotProfile(); while (true) {} } });",
      event: { type: "C2C_MESSAGE_CREATE", data: {} },
      config: {},
      kv: {},
      qqRequest: async () => ({ body: { username: "test" }, traceId: "trace" }),
    })).rejects.toThrow("PLUGIN_EXECUTION_TIMEOUT");
    expect(Date.now() - startedAt).toBeLessThan(2_000);
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
      permissions: ["storage:kv", "log:write", "qq:api"],
      configSchema: [{ key: "step", label: "步长", type: "number", required: true, min: 1, max: 10 }],
      configPage: { entry: "config.html", height: 760 },
      configPageHtml: "<main>计数器设置</main>",
    }));
    const installed = serviceModule.installPlugin(user, { projectId: imported.projectId, versionId: imported.versionId, botId, priority: 20 });
    databaseModule.getDatabase().prepare("DELETE FROM plugin_config_values WHERE installation_id = ?").run(installed.installationId);
    expect(() => serviceModule.updatePluginInstallation(user, installed.installationId, { enabled: true })).toThrow("PLUGIN_CONFIG_REQUIRED:step");
    serviceModule.updatePluginInstallation(user, installed.installationId, { enabled: true, config: { step: 3 } });
    expect(serviceModule.getPluginConfigPage(user, installed.installationId)).toEqual({ html: "<main>计数器设置</main>", height: 760 });
    serviceModule.setPluginRecord(user, installed.installationId, "dashboard.note", { text: "由配置页维护" });
    serviceModule.setPluginRecord(user, installed.installationId, "dashboard.note", { text: "由配置页更新" });
    expect(serviceModule.listPluginRecords(user, installed.installationId)).toEqual([
      expect.objectContaining({ key: "dashboard.note", value: { text: "由配置页更新" } }),
    ]);
    serviceModule.deletePluginRecord(user, installed.installationId, "dashboard.note");
    expect(serviceModule.listPluginRecords(user, installed.installationId)).toEqual([]);
    const asset = serviceModule.createPluginAsset(user, installed.installationId, {
      name: "reply.txt",
      mimeType: "text/plain",
      base64: Buffer.from("hosted asset", "utf8").toString("base64"),
    });
    expect(serviceModule.listPluginAssets(user, installed.installationId)).toEqual([
      expect.objectContaining({ id: asset.id, mimeType: "text/plain", size: 12 }),
    ]);
    expect(serviceModule.readPluginAsset(installed.installationId, asset.id).bytes.toString("utf8")).toBe("hosted asset");
    serviceModule.deletePluginAsset(user, installed.installationId, asset.id);
    expect(serviceModule.listPluginAssets(user, installed.installationId)).toEqual([]);

    await expect(serviceModule.dispatchHostedPlugins(botId, "C2C_MESSAGE_CREATE", { id: "hosted-event-1", content: "hello" }))
      .resolves.toEqual({ executed: 1, stopped: false });
    expect(databaseModule.getDatabase().prepare("SELECT value_json FROM plugin_kv WHERE installation_id = ? AND key = 'count'").get(installed.installationId))
      .toEqual({ value_json: "3" });
    expect(databaseModule.getDatabase().prepare("SELECT status, action_count FROM plugin_runs WHERE installation_id = ?").get(installed.installationId))
      .toEqual({ status: "success", action_count: 1 });
    expect(serviceModule.listPluginRuns(user, installed.installationId, 10)).toEqual([
      expect.objectContaining({ eventType: "C2C_MESSAGE_CREATE", eventKey: "hosted-event-1", status: "success", actionCount: 1 }),
    ]);

    const review = serviceModule.requestPluginReview(user, imported.projectId, imported.versionId);
    expect(() => serviceModule.requestPluginReview(user, imported.projectId, imported.versionId)).toThrow("PLUGIN_REVIEW_ALREADY_PENDING");
    const admin = sessionModule.authenticate("hosted-admin@test.local", "hosted-admin-password");
    expect(admin).not.toBeNull();
    serviceModule.reviewPlugin(admin!, review.reviewId, { approved: true, featured: true });
    const center = serviceModule.listPluginCenter(user);
    expect(center.installations[0]).toMatchObject({ id: installed.installationId, projectStatus: "published", enabled: true, priority: 20, config: { step: 3 }, configPage: { height: 760 } });
    expect(center.marketplace.find((plugin) => plugin.id === imported.projectId)).toMatchObject({ featured: true, owned: true });

    expect(() => serviceModule.updateMarketplacePlugin(user, imported.projectId, { name: "越权修改" })).toThrow("ADMIN_REQUIRED");
    expect(() => serviceModule.updateMarketplacePlugin(admin!, imported.projectId, { priceCents: -1 })).toThrow("PLUGIN_MARKETPLACE_PRICE_INVALID");
    serviceModule.updateMarketplacePlugin(admin!, imported.projectId, {
      name: "市场计数器",
      description: "由管理员维护的市场展示说明。",
      author: "StarBot 审核团队",
      category: "效率工具",
      tags: ["精选", "计数"],
      featured: false,
      priceCents: 1299,
    });
    const updatedMarketplace = serviceModule.listPluginCenter(user).marketplace.find((plugin) => plugin.id === imported.projectId);
    expect(updatedMarketplace).toMatchObject({
      name: "市场计数器",
      description: "由管理员维护的市场展示说明。",
      author: "StarBot 审核团队",
      category: "效率工具",
      tags: ["精选", "计数"],
      featured: false,
      priceCents: 1299,
      events: ["C2C_MESSAGE_CREATE"],
      permissions: ["storage:kv", "log:write", "qq:api"],
    });

    const nextVersion = await serviceModule.importPluginPackage(user, pluginPackage({ version: "1.1.0" }));
    serviceModule.updatePluginInstallation(user, installed.installationId, { versionId: nextVersion.versionId });
    expect(serviceModule.listPluginCenter(user).installations.find((installation) => installation.id === installed.installationId)).toMatchObject({
      versionId: nextVersion.versionId,
      version: "1.1.0",
      latestVersionId: nextVersion.versionId,
      latestVersion: "1.1.0",
      config: { step: 3 },
    });
    serviceModule.requestPluginReview(user, imported.projectId, nextVersion.versionId);
    const removed = serviceModule.removeMarketplacePlugin(admin!, imported.projectId, "安全复核下架");
    expect(removed).toEqual({ disabledInstallations: 1, cancelledReviews: 1 });
    expect(serviceModule.listPluginCenter(user).marketplace.some((plugin) => plugin.id === imported.projectId)).toBe(false);
    expect(databaseModule.getDatabase().prepare("SELECT status, review_note FROM plugin_projects WHERE id = ?").get(imported.projectId))
      .toEqual({ status: "suspended", review_note: "安全复核下架" });
    expect(databaseModule.getDatabase().prepare("SELECT enabled FROM plugin_installations WHERE id = ?").get(installed.installationId)).toEqual({ enabled: 0 });
    expect(serviceModule.listPluginCenter(user).installations.find((installation) => installation.id === installed.installationId)).toMatchObject({ projectStatus: "suspended", enabled: false });
    expect(databaseModule.getDatabase().prepare("SELECT status, review_note FROM plugin_market_reviews WHERE project_id = ? ORDER BY requested_at DESC LIMIT 1").get(imported.projectId))
      .toEqual({ status: "rejected", review_note: "安全复核下架" });
    await expect(serviceModule.dispatchHostedPlugins(botId, "C2C_MESSAGE_CREATE", { id: "hosted-event-after-removal" }))
      .resolves.toEqual({ executed: 0, stopped: false });
    expect(() => serviceModule.updatePluginInstallation(user, installed.installationId, { enabled: true })).toThrow("PLUGIN_PROJECT_SUSPENDED");
    expect(() => serviceModule.requestPluginReview(user, imported.projectId, nextVersion.versionId)).toThrow("PLUGIN_PROJECT_SUSPENDED");
    const auditActions = databaseModule.getDatabase().prepare("SELECT action FROM audit_logs WHERE target_id = ? ORDER BY created_at DESC").all(imported.projectId) as Array<{ action: string }>;
    expect(auditActions.map((row) => row.action)).toEqual(expect.arrayContaining([
      "hosted_plugin.marketplace.update",
      "hosted_plugin.marketplace.remove",
    ]));
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
      configPage: { entry: "config.html", height: 720 },
      configPageHtml: "<main>无记录权限</main>",
    }));
    const installed = serviceModule.installPlugin(user!, { projectId: imported.projectId, botId: bot.id });
    expect(() => serviceModule.listPluginRecords(user!, installed.installationId)).toThrow("PLUGIN_CONFIG_PAGE_RECORDS_DENIED");
    await expect(serviceModule.testPluginApi(user!, installed.installationId, {
      definition: { id: "denied", name: "Denied", method: "GET", url: "https://api.example.com", headers: {} },
      sample: {},
    })).rejects.toThrow("PLUGIN_CONFIG_PAGE_API_TEST_DENIED");
    serviceModule.updatePluginInstallation(user!, installed.installationId, { enabled: true });
    for (let index = 0; index < serviceModule.hostedPluginLimits.autoDisableFailures; index += 1) {
      await serviceModule.dispatchHostedPlugins(bot.id, "C2C_MESSAGE_CREATE", { id: `denied-${index}` });
    }
    expect(databaseModule.getDatabase().prepare("SELECT enabled, failure_count, last_error FROM plugin_installations WHERE id = ?").get(installed.installationId))
      .toEqual({ enabled: 0, failure_count: 5, last_error: "PLUGIN_PERMISSION_DENIED:storage:kv" });
    expect(databaseModule.getDatabase().prepare("SELECT COUNT(*) AS count FROM plugin_kv WHERE installation_id = ?").get(installed.installationId))
      .toEqual({ count: 0 });
  });

  it("dispatches every received event to wildcard plugins", async () => {
    const user = sessionModule.authenticate("plugin-author@example.com", "strong-password");
    expect(user).not.toBeNull();
    const bot = databaseModule.getDatabase().prepare("SELECT id FROM bots WHERE user_id = ? LIMIT 1").get(user!.id) as { id: string };
    const imported = await serviceModule.importPluginPackage(user!, pluginPackage({
      id: "wildcard-events",
      events: ["*"],
      permissions: ["storage:kv"],
      code: "StarBot.definePlugin({ onEvent(event, sdk) { sdk.kv.set('lastEvent', event.type); } });",
      configSchema: [],
    }));
    const installed = serviceModule.installPlugin(user!, { projectId: imported.projectId, botId: bot.id });
    serviceModule.updatePluginInstallation(user!, installed.installationId, { enabled: true });

    await expect(serviceModule.dispatchHostedPlugins(bot.id, "INTERACTION_CREATE", { id: "interaction-1" }))
      .resolves.toEqual({ executed: 1, stopped: false });
    expect(databaseModule.getDatabase().prepare("SELECT value_json FROM plugin_kv WHERE installation_id = ? AND key = 'lastEvent'").get(installed.installationId))
      .toEqual({ value_json: '"INTERACTION_CREATE"' });
  });

  it("renders configuration-page API test templates and extracts response paths", async () => {
    const user = sessionModule.authenticate("plugin-author@example.com", "strong-password");
    expect(user).not.toBeNull();
    const bot = databaseModule.getDatabase().prepare("SELECT id FROM bots WHERE user_id = ? LIMIT 1").get(user!.id) as { id: string };
    const imported = await serviceModule.importPluginPackage(user!, pluginPackage({
      id: "config-api-test",
      permissions: ["http:request"],
      configSchema: [],
      configPage: { entry: "config.html", height: 720 },
      configPageHtml: "<main>API 测试</main>",
    }));
    const installed = serviceModule.installPlugin(user!, { projectId: imported.projectId, botId: bot.id });
    const requests: Array<{ url: string; timeoutMs?: number; headers?: Record<string, string>; body?: unknown }> = [];

    const result = await serviceModule.testPluginApi(user!, installed.installationId, {
      definition: {
        id: "search",
        name: "搜索",
        method: "POST",
        responseMode: "json",
        responsePath: "data.items[0].url",
        responseType: "text",
        url: "https://api.example.com/search?q={{encode.query}}",
        headers: { "x-user": "{qqid}" },
        body: { message: "{message}", private: "{{is_private}}" },
        timeoutMs: 4500,
      },
      sample: { query: "北京 天气", qqid: "user-1", message: "天气 北京", is_private: true },
    }, {
      request: async (request) => {
        requests.push(request);
        return {
          url: request.url,
          status: 200,
          ok: true,
          headers: { "content-type": "application/json" },
          body: { data: { items: [{ url: "https://cdn.example.com/weather.png" }] } },
        };
      },
    });

    expect(requests).toEqual([expect.objectContaining({
      url: "https://api.example.com/search?q=%E5%8C%97%E4%BA%AC%20%E5%A4%A9%E6%B0%94",
      timeoutMs: 4500,
      headers: { "x-user": "user-1" },
      body: { message: "天气 北京", private: true },
    })]);
    expect(result).toMatchObject({ ok: true, status: 200, extracted: "https://cdn.example.com/weather.png" });
  });

  it("dispatches schedule ticks only to installations with an enabled schedule", async () => {
    const user = sessionModule.authenticate("plugin-author@example.com", "strong-password");
    expect(user).not.toBeNull();
    const bot = databaseModule.getDatabase().prepare("SELECT id FROM bots WHERE user_id = ? LIMIT 1").get(user!.id) as { id: string };
    const imported = await serviceModule.importPluginPackage(user!, pluginPackage({
      id: "scheduled-events",
      events: ["*"],
      permissions: ["storage:kv"],
      code: "StarBot.definePlugin({ onEvent(event, sdk) { sdk.kv.set('scheduleTick', event.data.minute); } });",
      configSchema: [{ key: "schedules", label: "计划", type: "textarea", required: true, default: "[]" }],
    }));
    const installed = serviceModule.installPlugin(user!, { projectId: imported.projectId, botId: bot.id });
    serviceModule.updatePluginInstallation(user!, installed.installationId, { enabled: true, config: { schedules: "[]" } });

    await expect(serviceModule.dispatchHostedPlugins(bot.id, "STARBOT_SCHEDULE_TICK", { timestamp: 1, minute: "2026-08-17T08:00" }))
      .resolves.toEqual({ executed: 0, stopped: false });
    serviceModule.updatePluginInstallation(user!, installed.installationId, { config: { schedules: "[{\"enabled\":false}]" } });
    await expect(serviceModule.dispatchHostedPlugins(bot.id, "STARBOT_SCHEDULE_TICK", { timestamp: 2, minute: "2026-08-17T08:01" }))
      .resolves.toEqual({ executed: 0, stopped: false });

    serviceModule.updatePluginInstallation(user!, installed.installationId, { config: { schedules: "[{\"enabled\":true}]" } });
    await expect(serviceModule.dispatchHostedPlugins(bot.id, "STARBOT_SCHEDULE_TICK", { timestamp: 3, minute: "2026-08-17T08:02" }))
      .resolves.toEqual({ executed: 1, stopped: false });
    expect(databaseModule.getDatabase().prepare("SELECT value_json FROM plugin_kv WHERE installation_id = ? AND `key` = 'scheduleTick'").get(installed.installationId))
      .toEqual({ value_json: '"2026-08-17T08:02"' });
  });

  it("removes installation assets when a plugin is uninstalled", async () => {
    const user = sessionModule.authenticate("plugin-author@example.com", "strong-password");
    expect(user).not.toBeNull();
    const bot = databaseModule.getDatabase().prepare("SELECT id FROM bots WHERE user_id = ? LIMIT 1").get(user!.id) as { id: string };
    const imported = await serviceModule.importPluginPackage(user!, pluginPackage({
      id: "asset-cleanup",
      permissions: ["qq:api"],
      configSchema: [],
      configPage: { entry: "config.html", height: 720 },
      configPageHtml: "<main>媒体</main>",
    }));
    const installed = serviceModule.installPlugin(user!, { projectId: imported.projectId, botId: bot.id });
    const asset = serviceModule.createPluginAsset(user!, installed.installationId, {
      name: "cleanup.txt",
      mimeType: "text/plain",
      base64: Buffer.from("cleanup", "utf8").toString("base64"),
    });
    expect(serviceModule.readPluginAsset(installed.installationId, asset.id).size).toBe(7);

    serviceModule.uninstallPlugin(user!, installed.installationId);

    expect(() => serviceModule.readPluginAsset(installed.installationId, asset.id)).toThrow("PLUGIN_ASSET_NOT_FOUND");
    expect(serviceModule.listPluginCenter(user!).installations.some((item) => item.id === installed.installationId)).toBe(false);
  });

  it("keeps an official marketplace deletion after database restart", () => {
    const admin = sessionModule.authenticate("hosted-admin@test.local", "hosted-admin-password");
    expect(admin).not.toBeNull();
    const officialProjectId = "starbot-official-keyword-reply";
    expect(serviceModule.listPluginCenter(admin!).marketplace.some((plugin) => plugin.id === officialProjectId)).toBe(true);
    serviceModule.removeMarketplacePlugin(admin!, officialProjectId, "官方插件维护下架");

    const state = globalThis as typeof globalThis & { __starbotDatabase?: { close(): void } };
    state.__starbotDatabase?.close();
    delete state.__starbotDatabase;
    databaseModule.getDatabase();

    expect(serviceModule.listPluginCenter(admin!).marketplace.some((plugin) => plugin.id === officialProjectId)).toBe(false);
    expect(databaseModule.getDatabase().prepare("SELECT status FROM plugin_projects WHERE id = ?").get(officialProjectId)).toEqual({ status: "suspended" });
  });
});
