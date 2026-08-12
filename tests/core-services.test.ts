import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "starbot-test-"));
const databasePath = path.join(temporaryDirectory, "starbot.db");

let databaseModule: typeof import("@/lib/database");
let botServiceModule: typeof import("@/lib/bot-service");
let cryptoModule: typeof import("@/lib/crypto-vault");
let eventRetentionModule: typeof import("@/lib/event-retention");
let eventIngestionModule: typeof import("@/lib/event-ingestion");
let gatewayCoordinationModule: typeof import("@/lib/gateway-coordination");
let membershipModule: typeof import("@/lib/membership-service");
let passwordModule: typeof import("@/lib/password");
let pluginModule: typeof import("@/lib/plugin-service");
let qqApiModule: typeof import("@/lib/qq-api");
let qqMediaModule: typeof import("@/lib/qq-media");
let qqWebhookModule: typeof import("@/lib/qq-webhook");
let qqWebhookTokenModule: typeof import("@/lib/qq-webhook-token");
let rawUploadModule: typeof import("@/lib/raw-upload");
let securityModule: typeof import("@/lib/security");
let sessionModule: typeof import("@/lib/session");
let userServiceModule: typeof import("@/lib/user-service");

beforeAll(async () => {
  process.env.DATABASE_PATH = databasePath;
  process.env.BOOTSTRAP_ADMIN_EMAIL = "admin@test.local";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "admin-password-2026";
  process.env.ALLOW_PRIVATE_WEBHOOKS = "false";
  process.env.ALLOW_INSECURE_WEBHOOKS = "false";
  [databaseModule, botServiceModule, cryptoModule, eventRetentionModule, eventIngestionModule, gatewayCoordinationModule, membershipModule, passwordModule, pluginModule, qqApiModule, qqMediaModule, qqWebhookModule, qqWebhookTokenModule, rawUploadModule, securityModule, sessionModule, userServiceModule] = await Promise.all([
    import("@/lib/database"),
    import("@/lib/bot-service"),
    import("@/lib/crypto-vault"),
    import("@/lib/event-retention"),
    import("@/lib/event-ingestion"),
    import("@/lib/gateway-coordination"),
    import("@/lib/membership-service"),
    import("@/lib/password"),
    import("@/lib/plugin-service"),
    import("@/lib/qq-api"),
    import("@/lib/qq-media"),
    import("@/lib/qq-webhook"),
    import("@/lib/qq-webhook-token"),
    import("@/lib/raw-upload"),
    import("@/lib/security"),
    import("@/lib/session"),
    import("@/lib/user-service"),
  ]);
  databaseModule.getDatabase();
});

afterAll(() => {
  const state = globalThis as typeof globalThis & { __starbotDatabase?: { close(): void } };
  state.__starbotDatabase?.close();
  delete state.__starbotDatabase;
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("authentication and membership", () => {
  it("seeds memberships consistently with bootstrap quotas", () => {
    const admin = sessionModule.authenticate("admin@test.local", "admin-password-2026");
    expect(admin).toMatchObject({ role: "admin", botQuota: 12, membershipPlan: "pro", membershipName: "专业版" });
  });

  it("registers users on the free plan", () => {
    const user = sessionModule.registerUser({ name: "测试用户", email: "user@example.com", password: "strong-password" });
    expect(user).toMatchObject({ botQuota: 1, membershipPlan: "free", membershipName: "免费版" });
    expect(sessionModule.authenticate("user@example.com", "strong-password")).toMatchObject({ id: user.id, membershipPlan: "free" });
  });

  it("allows admins to assign plans and denies regular users", () => {
    const admin = sessionModule.authenticate("admin@test.local", "admin-password-2026");
    const user = sessionModule.authenticate("user@example.com", "strong-password");
    expect(admin).not.toBeNull();
    expect(user).not.toBeNull();
    expect(membershipModule.assignMembershipPlan(admin!, user!.id, "pro")).toMatchObject({ botQuota: 5, plan: { id: "pro" } });
    expect(() => membershipModule.assignMembershipPlan(user!, admin!.id, "free")).toThrow("ADMIN_REQUIRED");
  });

  it("prunes events using the assigned plan retention window", () => {
    const database = databaseModule.getDatabase();
    const user = sessionModule.authenticate("user@example.com", "strong-password");
    expect(user).not.toBeNull();
    const botId = randomUUID();
    database.prepare(`
      INSERT INTO bots (id, user_id, name, app_id, client_secret_cipher, environment, intents, status, created_at, updated_at)
      VALUES (?, ?, 'Retention Bot', 'retention-app-id', ?, 'sandbox', 0, 'offline', ?, ?)
    `).run(botId, user!.id, cryptoModule.encryptSecret("test-client-secret"), new Date().toISOString(), new Date().toISOString());
    database.prepare(`
      INSERT INTO event_logs (id, bot_id, event_type, scene, status, latency_ms, content, payload_json, trace_id, received_at)
      VALUES (?, ?, 'OLD_EVENT', '系统', 'success', 0, '', '{}', NULL, datetime('now', '-31 days'))
    `).run(randomUUID(), botId);
    expect(eventRetentionModule.pruneExpiredEvents()).toBeGreaterThanOrEqual(1);
    expect((database.prepare("SELECT COUNT(*) AS count FROM event_logs WHERE bot_id = ?").get(botId) as { count: number }).count).toBe(0);
  });

  it("hashes passwords with a unique salt and verifies them safely", () => {
    const first = passwordModule.hashPassword("same-password");
    const second = passwordModule.hashPassword("same-password");
    expect(first).not.toBe(second);
    expect(passwordModule.verifyPassword("same-password", first)).toBe(true);
    expect(passwordModule.verifyPassword("wrong-password", first)).toBe(false);
  });

  it("protects the current and last administrator account", () => {
    const admin = sessionModule.authenticate("admin@test.local", "admin-password-2026");
    expect(admin).not.toBeNull();
    expect(() => userServiceModule.updateUserAccess(admin!, admin!.id, { role: "developer", status: "active" })).toThrow("SELF_ADMIN_PROTECTION");
    expect(() => userServiceModule.updateUserAccess(admin!, admin!.id, { role: "admin", status: "suspended" })).toThrow("SELF_ADMIN_PROTECTION");
  });

  it("allows admins to suspend and reactivate users", () => {
    const admin = sessionModule.authenticate("admin@test.local", "admin-password-2026");
    const user = sessionModule.authenticate("user@example.com", "strong-password");
    expect(admin).not.toBeNull();
    expect(user).not.toBeNull();
    const database = databaseModule.getDatabase();
    database.prepare("UPDATE bots SET auto_connect = 1 WHERE user_id = ?").run(user!.id);
    expect((database.prepare("SELECT COUNT(*) AS count FROM bots WHERE user_id = ? AND auto_connect = 1").get(user!.id) as { count: number }).count).toBeGreaterThan(0);
    expect(userServiceModule.updateUserAccess(admin!, user!.id, { role: "operator", status: "suspended" })).toEqual({ role: "operator", status: "suspended" });
    expect(sessionModule.authenticate("user@example.com", "strong-password")).toBeNull();
    expect((database.prepare("SELECT COUNT(*) AS count FROM bots WHERE user_id = ? AND auto_connect = 1").get(user!.id) as { count: number }).count).toBe(0);
    expect(userServiceModule.updateUserAccess(admin!, user!.id, { role: "developer", status: "active" })).toEqual({ role: "developer", status: "active" });
  });
});

describe("request security", () => {
  it("limits repeated requests within a window", () => {
    securityModule.consumeRateLimit("test-bucket", 2, 60_000);
    securityModule.consumeRateLimit("test-bucket", 2, 60_000);
    expect(() => securityModule.consumeRateLimit("test-bucket", 2, 60_000)).toThrow(securityModule.RateLimitError);
  });

  it("rejects cross-site mutation origins", () => {
    const trusted = new Request("https://console.example.com/api/auth/login", { headers: { origin: "https://console.example.com" } });
    expect(() => securityModule.assertTrustedRequest(trusted)).not.toThrow();
    const untrusted = new Request("https://console.example.com/api/auth/login", { headers: { origin: "https://attacker.example" } });
    expect(() => securityModule.assertTrustedRequest(untrusted)).toThrow("UNTRUSTED_ORIGIN");
  });

  it("accepts only relative QQ API paths", () => {
    expect(qqApiModule.validateQQApiPath("/gateway/bot")).toBe("/gateway/bot");
    expect(qqApiModule.validateQQApiPath("/v2/users/demo/messages?foo=bar")).toBe("/v2/users/demo/messages?foo=bar");
    expect(() => qqApiModule.validateQQApiPath("https://attacker.example/path")).toThrow("QQ_API_PATH_INVALID");
    expect(() => qqApiModule.validateQQApiPath("/v2/../secret")).toThrow("QQ_API_PATH_INVALID");
  });

  it("authenticates signed plugin requests and rejects nonce replay", () => {
    const database = databaseModule.getDatabase();
    const user = sessionModule.authenticate("user@example.com", "strong-password");
    expect(user).not.toBeNull();
    const now = new Date().toISOString();
    const botId = randomUUID();
    const pluginId = randomUUID();
    const secret = "plugin-test-secret";
    database.prepare(`
      INSERT INTO bots (id, user_id, name, app_id, client_secret_cipher, environment, intents, status, created_at, updated_at)
      VALUES (?, ?, 'Test Bot', 'test-app-id', ?, 'sandbox', 0, 'offline', ?, ?)
    `).run(botId, user!.id, cryptoModule.encryptSecret("test-client-secret"), now, now);
    database.prepare(`
      INSERT INTO plugins (id, user_id, bot_id, name, slug, version, runtime, events_json, permissions_json, signing_secret_cipher, enabled, created_at, updated_at)
      VALUES (?, ?, ?, 'Test SDK App', 'test-sdk-app', '1.0.0', 'sdk', '["*"]', '["event:receive","qq:api"]', ?, 1, ?, ?)
    `).run(pluginId, user!.id, botId, cryptoModule.encryptSecret(secret), now, now);

    const timestamp = Date.now().toString();
    const nonce = "a-valid-test-nonce-2026";
    const body = JSON.stringify({ method: "GET", path: "/gateway/bot" });
    const signature = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("hex")}`;
    expect(pluginModule.authenticatePluginRequest(pluginId, timestamp, nonce, body, signature)).toEqual({ botId, permissions: ["event:receive", "qq:api"] });
    expect(() => pluginModule.authenticatePluginRequest(pluginId, timestamp, nonce, body, signature)).toThrow("PLUGIN_REQUEST_REPLAYED");

    const multipartNonce = "multipart-test-nonce-2026";
    const contentType = "multipart/form-data; boundary=starbot-test-boundary";
    const multipartBody = Buffer.from("--starbot-test-boundary\r\ncontent\r\n--starbot-test-boundary--\r\n");
    const canonical = ["POST", "/v2/users/openid/files", contentType, createHash("sha256").update(multipartBody).digest("hex")].join("\n");
    const multipartSignature = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${multipartNonce}.${canonical}`).digest("hex")}`;
    expect(pluginModule.authenticatePluginCanonicalRequest(pluginId, timestamp, multipartNonce, canonical, multipartSignature)).toEqual({ botId, permissions: ["event:receive", "qq:api"] });
    expect(() => pluginModule.authenticatePluginCanonicalRequest(pluginId, timestamp, multipartNonce, canonical, multipartSignature)).toThrow("PLUGIN_REQUEST_REPLAYED");
  });

  it("claims SDK events atomically and acknowledges only the active lease", async () => {
    const database = databaseModule.getDatabase();
    const user = sessionModule.authenticate("user@example.com", "strong-password");
    expect(user).not.toBeNull();
    database.prepare("DELETE FROM plugin_deliveries").run();
    const now = new Date().toISOString();
    const botId = randomUUID();
    const pluginId = randomUUID();
    const deliveryId = randomUUID();
    database.prepare(`
      INSERT INTO bots (id, user_id, name, app_id, client_secret_cipher, environment, intents, status, created_at, updated_at)
      VALUES (?, ?, 'Lease Bot', ?, ?, 'sandbox', 0, 'offline', ?, ?)
    `).run(botId, user!.id, `lease-app-${botId}`, cryptoModule.encryptSecret("lease-client-secret"), now, now);
    database.prepare(`
      INSERT INTO plugins (id, user_id, bot_id, name, slug, version, runtime, events_json, permissions_json, signing_secret_cipher, enabled, created_at, updated_at)
      VALUES (?, ?, ?, 'Lease SDK App', ?, '1.0.0', 'sdk', '["*"]', '["event:receive"]', ?, 1, ?, ?)
    `).run(pluginId, user!.id, botId, `lease-plugin-${pluginId}`, cryptoModule.encryptSecret("lease-plugin-secret"), now, now);
    database.prepare(`
      INSERT INTO plugin_deliveries (id, plugin_id, bot_id, event_type, payload_json, status, attempts, next_attempt_at, lease_owner, lease_expires_at, created_at, updated_at)
      VALUES (?, ?, ?, 'GROUP_MESSAGE_CREATE', ?, 'delivering', 1, ?, 'expired-owner', ?, ?, ?)
    `).run(deliveryId, pluginId, botId, JSON.stringify({ id: deliveryId, type: "GROUP_MESSAGE_CREATE", botId, createdAt: now, data: { content: "hello" } }), now, Date.now() - 1_000, now, now);

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => pluginModule.claimSdkEvents(pluginId, 10)),
      Promise.resolve().then(() => pluginModule.claimSdkEvents(pluginId, 10)),
    ]);
    const claim = first.events.length ? first : second;
    const emptyClaim = first.events.length ? second : first;
    expect(claim.events).toHaveLength(1);
    expect(claim.events[0]).toMatchObject({ id: deliveryId, type: "GROUP_MESSAGE_CREATE", attempt: 2 });
    expect(emptyClaim.events).toHaveLength(0);
    expect(pluginModule.acknowledgeSdkEvents(pluginId, "wrong-lease-token", [deliveryId])).toBe(0);
    expect(pluginModule.acknowledgeSdkEvents(pluginId, claim.leaseToken!, [deliveryId])).toBe(1);
    expect(database.prepare("SELECT status, attempts, lease_owner, lease_expires_at FROM plugin_deliveries WHERE id = ?").get(deliveryId)).toEqual({
      status: "succeeded",
      attempts: 2,
      lease_owner: null,
      lease_expires_at: null,
    });
  });

  it("matches the QQ webhook Ed25519 challenge example", () => {
    expect(qqWebhookModule.signQQWebhookChallenge("DG5g3B4j9X2KOErG", "1725442341", "Arq0D5A61EgUu4OxUvOp")).toBe(
      "87befc99c42c651b3aac0278e71ada338433ae26fcb24307bdc5ad38c1adc2d01bcfcadc0842edac85e85205028a1132afe09280305f13aa6909ffc2d652c706",
    );
  });

  it("rejects invalid QQ webhook identity and signatures", async () => {
    const database = databaseModule.getDatabase();
    const bot = database.prepare("SELECT id, app_id, client_secret_cipher FROM bots ORDER BY created_at ASC LIMIT 1").get() as { id: string; app_id: string; client_secret_cipher: string };
    const token = qqWebhookTokenModule.deriveQQWebhookToken(bot.id, bot.client_secret_cipher);
    const challengeBody = JSON.stringify({ op: 13, d: { plain_token: "challenge-token", event_ts: "1725442341" } });
    await expect(qqWebhookModule.handleQQWebhook(bot.id, token, bot.app_id, challengeBody, new Headers())).rejects.toThrow("QQ_WEBHOOK_MODE_REQUIRED");
    database.prepare("UPDATE bots SET connection_mode = 'webhook' WHERE id = ?").run(bot.id);
    await expect(qqWebhookModule.handleQQWebhook(bot.id, "invalid-token", bot.app_id, challengeBody, new Headers())).rejects.toThrow("QQ_WEBHOOK_TOKEN_INVALID");
    await expect(qqWebhookModule.handleQQWebhook(bot.id, token, "wrong-app-id", challengeBody, new Headers())).rejects.toThrow("QQ_WEBHOOK_APP_ID_MISMATCH");
    await expect(qqWebhookModule.handleQQWebhook(bot.id, token, bot.app_id, challengeBody, new Headers())).resolves.toMatchObject({
      challenge: { plain_token: "challenge-token" },
    });

    const eventBody = JSON.stringify({ op: 0, t: "C2C_MESSAGE_CREATE", id: "invalid-signature-event", d: { id: "invalid-signature-message" } });
    const headers = new Headers({
      "x-signature-timestamp": Math.floor(Date.now() / 1000).toString(),
      "x-signature-ed25519": "0".repeat(128),
    });
    await expect(qqWebhookModule.handleQQWebhook(bot.id, token, bot.app_id, eventBody, headers)).rejects.toThrow("QQ_WEBHOOK_SIGNATURE_INVALID");
    database.prepare("UPDATE bots SET connection_mode = 'websocket', status = 'offline' WHERE id = ?").run(bot.id);
  });

  it("coordinates gateway ownership and persists shard sessions", () => {
    expect(botServiceModule.defaultQQGatewayIntents).toBe(1 << 25);
    const database = databaseModule.getDatabase();
    const bot = database.prepare("SELECT id FROM bots ORDER BY created_at ASC LIMIT 1").get() as { id: string };
    database.prepare("UPDATE bots SET intents = 0 WHERE id = ?").run(bot.id);
    expect(botServiceModule.getBotGatewayConfig(bot.id).intents).toBe(botServiceModule.defaultQQGatewayIntents);
    database.prepare("UPDATE bots SET auto_connect = 1 WHERE id = ?").run(bot.id);
    expect(gatewayCoordinationModule.acquireGatewayLease(bot.id, 1_000)).toBe(true);
    expect(gatewayCoordinationModule.renewGatewayLease(bot.id, 2_000)).toBe(true);
    expect(gatewayCoordinationModule.prepareGatewayShards(bot.id, 3)).toHaveLength(3);
    gatewayCoordinationModule.updateGatewayShardSession(bot.id, 1, { status: "online", sessionId: "session-1", sequence: 42, lastAckAt: 2_500 });
    expect(gatewayCoordinationModule.listGatewayShardSessions(bot.id)[1]).toMatchObject({ shardId: 1, shardCount: 3, status: "online", sessionId: "session-1", sequence: 42 });
    const resized = gatewayCoordinationModule.prepareGatewayShards(bot.id, 2);
    expect(resized).toHaveLength(2);
    expect(resized.every((session) => session.sessionId === null && session.sequence === null)).toBe(true);
    const owner = database.prepare("SELECT user_id FROM bots WHERE id = ?").get(bot.id) as { user_id: string };
    database.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(owner.user_id);
    expect(gatewayCoordinationModule.renewGatewayLease(bot.id, 3_000)).toBe(false);
    gatewayCoordinationModule.releaseGatewayLease(bot.id);
    expect(gatewayCoordinationModule.acquireGatewayLease(bot.id, 3_000)).toBe(false);
    database.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(owner.user_id);
    gatewayCoordinationModule.releaseGatewayLease(bot.id);
  });

  it("deduplicates resumed gateway events before plugin delivery", async () => {
    const database = databaseModule.getDatabase();
    const bot = database.prepare("SELECT id FROM bots ORDER BY created_at ASC LIMIT 1").get() as { id: string };
    const payload = { op: 0, t: "GROUP_MESSAGE_CREATE", s: 99, id: "event-deduplication-2026", d: { id: "message-deduplication-2026", content: "hello" } };
    expect((await eventIngestionModule.ingestQQEvent(bot.id, "gateway", payload)).accepted).toBe(true);
    expect((await eventIngestionModule.ingestQQEvent(bot.id, "qq_webhook", payload)).reason).toBe("DUPLICATE");
    expect((database.prepare("SELECT COUNT(*) AS count FROM event_logs WHERE bot_id = ? AND event_type = 'GROUP_MESSAGE_CREATE'").get(bot.id) as { count: number }).count).toBe(1);
  });

  it("streams multipart media to a temporary file with official hashes", async () => {
    const bytes = Buffer.from("starbot-media-parser-test");
    const form = new FormData();
    form.set("targetType", "c2c");
    form.set("targetOpenid", "openid-test-2026");
    form.set("fileType", "1");
    form.set("srvSendMsg", "false");
    form.set("file", new File([bytes], "avatar.png", { type: "image/png" }));
    const upload = await qqMediaModule.parseMediaUploadRequest(new Request("http://localhost/media", { method: "POST", body: form }));
    try {
      expect(upload).toMatchObject({ fileName: "avatar.png", fileSize: bytes.length, fileType: 1, targetType: "c2c", targetOpenid: "openid-test-2026", srvSendMsg: false });
      expect(upload.md5).toBe(createHash("md5").update(bytes).digest("hex"));
      expect(upload.sha1).toBe(createHash("sha1").update(bytes).digest("hex"));
      expect(fs.readFileSync(upload.tempPath)).toEqual(bytes);
    } finally {
      await qqMediaModule.removeParsedMediaUpload(upload);
    }
    expect(fs.existsSync(upload.tempPath)).toBe(false);
  });

  it("spools raw multipart bodies with SHA256 and always supports cleanup", async () => {
    const bytes = Buffer.from("raw-multipart-upload-test");
    const request = new Request("http://localhost/multipart", { method: "POST", body: bytes });
    const upload = await rawUploadModule.spoolRequestBody(request.body!);
    expect(upload).toMatchObject({ size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    expect(fs.readFileSync(upload.tempPath)).toEqual(bytes);
    await rawUploadModule.removeRawUpload(upload.tempPath);
    expect(fs.existsSync(upload.tempPath)).toBe(false);

    const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("starbot-raw-") && name.endsWith(".upload")));
    const oversized = new Request("http://localhost/multipart", { method: "POST", body: Buffer.from("12345") });
    await expect(rawUploadModule.spoolRequestBody(oversized.body!, 4)).rejects.toThrow("MULTIPART_BODY_TOO_LARGE");
    const after = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("starbot-raw-") && name.endsWith(".upload")));
    expect(after).toEqual(before);
  });

  it("uploads exact file ranges and confirms every QQ media part", async () => {
    const bytes = Buffer.from("abcdefghij");
    const tempPath = path.join(temporaryDirectory, "media-parts.bin");
    fs.writeFileSync(tempPath, bytes);
    const requests: Array<{ path: string; payload?: unknown }> = [];
    const client = {
      request: async (requestPath: string, _method: string, payload?: unknown) => {
        requests.push({ path: requestPath, payload });
        if (requestPath.endsWith("/upload_prepare")) return {
          body: {
            upload_id: "upload-test-2026",
            block_size: "4",
            parts: [
              { index: 0, presigned_url: "https://upload.example/0", block_size: "4" },
              { index: 1, presigned_url: "https://upload.example/1", block_size: "4" },
              { index: 2, presigned_url: "https://upload.example/2", block_size: "2" },
            ],
            upload_config: { concurrency: 2, retry_timeout: 5, retry_delay: 1 },
          },
          traceId: null,
        };
        if (requestPath.endsWith("/files")) return { body: { file_info: "file-info-test" }, traceId: "trace-test" };
        return { body: {}, traceId: null };
      },
    };
    const uploadedParts = new Map<string, Buffer>();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const chunks: Buffer[] = [];
      for await (const chunk of init?.body as unknown as NodeJS.ReadableStream) chunks.push(Buffer.from(chunk));
      uploadedParts.set(String(input), Buffer.concat(chunks));
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    try {
      const result = await qqMediaModule.uploadQQMedia(client as unknown as import("@/lib/qq-api").QQBotApiClient, {
        tempPath,
        fileName: "demo.mp4",
        fileSize: bytes.length,
        fileType: 2,
        targetType: "group",
        targetOpenid: "group-test-2026",
        srvSendMsg: false,
        md5: createHash("md5").update(bytes).digest("hex"),
        sha1: createHash("sha1").update(bytes).digest("hex"),
        md5First10m: createHash("md5").update(bytes).digest("hex"),
      });
      expect(result).toMatchObject({ body: { file_info: "file-info-test" }, traceId: "trace-test" });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(uploadedParts.get("https://upload.example/0")).toEqual(Buffer.from("abcd"));
    expect(uploadedParts.get("https://upload.example/1")).toEqual(Buffer.from("efgh"));
    expect(uploadedParts.get("https://upload.example/2")).toEqual(Buffer.from("ij"));
    const finishRequests = requests.filter((entry) => entry.path.endsWith("/upload_part_finish"));
    expect(finishRequests).toHaveLength(3);
    expect(finishRequests.map((entry) => {
      const payload = entry.payload as { part_index: number; md5: string };
      return { part_index: payload.part_index, md5: payload.md5 };
    }).sort((left, right) => left.part_index - right.part_index)).toEqual([
      { part_index: 0, md5: createHash("md5").update("abcd").digest("hex") },
      { part_index: 1, md5: createHash("md5").update("efgh").digest("hex") },
      { part_index: 2, md5: createHash("md5").update("ij").digest("hex") },
    ]);
    expect(requests.at(-1)?.path).toBe("/v2/groups/group-test-2026/files");
  });
});
