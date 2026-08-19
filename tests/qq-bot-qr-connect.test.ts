import fs from "node:fs";
import { createCipheriv, randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "starbot-qq-bot-qr-test-"));
const databasePath = path.join(temporaryDirectory, "starbot.db");
let databaseModule: typeof import("@/lib/database");
let botQrModule: typeof import("@/lib/qq-bot-qr-connect");
let botServiceModule: typeof import("@/lib/bot-service");
let cryptoModule: typeof import("@/lib/crypto-vault");
let sessionModule: typeof import("@/lib/session");
let gatewayManagerModule: typeof import("@/lib/gateway-manager");
let qrPollResponse: Record<string, unknown> = { status: 1, bot_appid: "0", bot_encrypt_secret: "", user_openid: "" };
let qrTaskKey = "";
let qrRequestHosts: string[] = [];

function encryptedSecret(secret: string, keyBase64: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyBase64, "base64"), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString("base64");
}

beforeAll(async () => {
  process.env.DATABASE_PATH = databasePath;
  process.env.BOOTSTRAP_ADMIN_EMAIL = "qr-admin@test.local";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "admin-password-2026";
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 41).toString("base64");
  [databaseModule, botQrModule, botServiceModule, cryptoModule, sessionModule, gatewayManagerModule] = await Promise.all([
    import("@/lib/database"),
    import("@/lib/qq-bot-qr-connect"),
    import("@/lib/bot-service"),
    import("@/lib/crypto-vault"),
    import("@/lib/session"),
    import("@/lib/gateway-manager"),
  ]);
  databaseModule.getDatabase();
});

beforeEach(() => {
  qrTaskKey = "";
  qrRequestHosts = [];
  qrPollResponse = { status: 1, bot_appid: "0", bot_encrypt_secret: "", user_openid: "" };
  vi.spyOn(gatewayManagerModule.gatewayManager, "connectPending").mockResolvedValue({
    connected: true,
    reconnecting: false,
    owned: true,
    shardCount: 1,
    onlineShards: 0,
    lastAckAt: null,
  });
  vi.spyOn(gatewayManagerModule.gatewayManager, "waitForConnected").mockResolvedValue(true);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (["q.qq.com", "test.q.qq.com"].includes(url.hostname) && url.pathname === "/lite/create_bind_task") {
      qrRequestHosts.push(url.hostname);
      const request = input instanceof Request ? await input.clone().json() : JSON.parse(String(init?.body || "{}"));
      qrTaskKey = typeof request.key === "string" ? request.key : "";
      return Response.json({ retcode: 0, msg: "success", data: { task_id: "qr-test-task" } });
    }
    if (["q.qq.com", "test.q.qq.com"].includes(url.hostname) && url.pathname === "/lite/poll_bind_result") {
      qrRequestHosts.push(url.hostname);
      const response = { ...qrPollResponse };
      if (response.status === 2 && !response.bot_encrypt_secret) {
        response.bot_appid ||= "qr-app-id";
        response.bot_encrypt_secret = encryptedSecret("qr-app-secret", qrTaskKey);
      }
      return Response.json({ retcode: 0, msg: "success", data: response });
    }
    if (url.pathname === "/app/getAppAccessToken") return Response.json({ access_token: "access-token", expires_in: 3600 });
    if (url.pathname === "/users/@me") return Response.json({ id: "qq-bot-id", username: "扫码机器人" });
    throw new Error(`Unexpected QQ URL: ${url}`);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(() => {
  const state = globalThis as typeof globalThis & { __starbotDatabase?: { close(): void } };
  state.__starbotDatabase?.close();
  delete state.__starbotDatabase;
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

async function waitForStatus(sessionId: string, status: string, attempts = 30) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const admin = sessionModule.authenticate("qr-admin@test.local", "admin-password-2026")!;
    const session = botQrModule.getQrSession(admin, sessionId);
    if (session.status === status) return session;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${status}`);
}

describe("QQ bot QR connect", () => {
  it("stores the QR URL, imports the returned bot, and encrypts its secret", async () => {
    const admin = sessionModule.authenticate("qr-admin@test.local", "admin-password-2026")!;
    qrPollResponse = { status: 2, bot_appid: "qr-app-id", bot_encrypt_secret: "", user_openid: "" };
    const session = botQrModule.startQrSession(admin, { environment: "sandbox", connectionMode: "websocket" });
    expect(session.status).toBe("pending");
    const completed = await waitForStatus(session.id, "completed", 500);
    expect(completed.qrRevision).toBe(1);
    expect(completed.botId).toBeTruthy();
    expect(gatewayManagerModule.gatewayManager.connectPending).toHaveBeenCalledWith(completed.botId);
    const bot = databaseModule.getDatabase().prepare("SELECT app_id, client_secret_cipher FROM bots WHERE id = ?").get(completed.botId) as { app_id: string; client_secret_cipher: string };
    expect(bot.app_id).toBe("qr-app-id");
    expect(cryptoModule.decryptSecret(bot.client_secret_cipher)).toBe("qr-app-secret");
    expect(botServiceModule.listBots(admin)).toHaveLength(1);
  });

  it("uses the official generic QQ connection source", async () => {
    const admin = sessionModule.authenticate("qr-admin@test.local", "admin-password-2026")!;
    const session = botQrModule.startQrSession(admin, { environment: "sandbox", connectionMode: "webhook" });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const current = botQrModule.getQrSession(admin, session.id);
      if (current.qrRevision > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const qrUrl = botQrModule.getQrSessionImage(admin, session.id);
    expect(qrRequestHosts[0]).toBe("test.q.qq.com");
    expect(new URL(qrUrl).hostname).toBe("q.qq.com");
    expect(new URL(qrUrl).searchParams.get("source")).toBe("");
    botQrModule.cancelQrSession(admin, session.id);
  });

  it("uses q.qq.com for production bind API calls", async () => {
    const admin = sessionModule.authenticate("qr-admin@test.local", "admin-password-2026")!;
    const session = botQrModule.startQrSession(admin, { environment: "production", connectionMode: "webhook" });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const current = botQrModule.getQrSession(admin, session.id);
      if (current.qrRevision > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(qrRequestHosts[0]).toBe("q.qq.com");
    botQrModule.cancelQrSession(admin, session.id);
  });

  it("preserves QQ API credential error codes for the UI", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname === "q.qq.com" && url.pathname === "/lite/create_bind_task") {
        const request = input instanceof Request ? await input.clone().json() : JSON.parse(String(init?.body || "{}"));
        qrTaskKey = typeof request.key === "string" ? request.key : "";
        return Response.json({ retcode: 0, msg: "success", data: { task_id: "qr-test-task" } });
      }
      if (url.hostname === "q.qq.com" && url.pathname === "/lite/poll_bind_result") {
        return Response.json({
          retcode: 0,
          msg: "success",
          data: { status: 2, bot_appid: "invalid-app-id", bot_encrypt_secret: encryptedSecret("invalid-app-secret", qrTaskKey) },
        });
      }
      if (url.pathname === "/app/getAppAccessToken") {
        return Response.json({ err_code: 100016, message: "invalid appid or secret" }, {
          status: 401,
          headers: { "X-Tps-trace-ID": "qr-test-trace" },
        });
      }
      throw new Error(`Unexpected QQ URL: ${url}`);
    });
    const admin = sessionModule.authenticate("qr-admin@test.local", "admin-password-2026")!;
    qrPollResponse = { status: 2, bot_appid: "invalid-app-id", bot_encrypt_secret: "", user_openid: "" };
    const session = botQrModule.startQrSession(admin, { environment: "production", connectionMode: "webhook" });
    await expect(waitForStatus(session.id, "failed")).resolves.toMatchObject({ errorCode: "QQ_BOT_API_100016" });
  });

  it("retries a transient Gateway authorization failure before completing the QR handoff", async () => {
    const qqApiModule = await import("@/lib/qq-api");
    vi.useFakeTimers();
    vi.spyOn(gatewayManagerModule.gatewayManager, "connectPending")
      .mockRejectedValueOnce(new qqApiModule.QQApiError("QQ API 请求失败，HTTP 401", 401, "qr-gateway-trace", { code: 40011034, message: "bot is propagating" }))
      .mockResolvedValue({
        connected: true,
        reconnecting: false,
        owned: true,
        shardCount: 1,
        onlineShards: 1,
        lastAckAt: Date.now(),
      });
    const admin = sessionModule.authenticate("qr-admin@test.local", "admin-password-2026")!;
    qrPollResponse = { status: 2, bot_appid: "qr-transient-gateway-app", bot_encrypt_secret: "", user_openid: "" };
    const session = botQrModule.startQrSession(admin, { environment: "production", connectionMode: "websocket" });
    await vi.advanceTimersByTimeAsync(1_100);
    const completed = botQrModule.getQrSession(admin, session.id);
    expect(completed).toMatchObject({ status: "completed", errorCode: null });
    expect(gatewayManagerModule.gatewayManager.connectPending).toHaveBeenCalledTimes(2);
    expect(databaseModule.getDatabase().prepare("SELECT auto_connect FROM bots WHERE id = ?").get(completed.botId)).toEqual({ auto_connect: 1 });
  });

  it("imports QR credentials when QQ profile propagation returns 40011034", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname === "q.qq.com" && url.pathname === "/lite/create_bind_task") {
        const request = input instanceof Request ? await input.clone().json() : JSON.parse(String(init?.body || "{}"));
        qrTaskKey = typeof request.key === "string" ? request.key : "";
        return Response.json({ retcode: 0, msg: "success", data: { task_id: "qr-profile-delay-task" } });
      }
      if (url.hostname === "q.qq.com" && url.pathname === "/lite/poll_bind_result") {
        return Response.json({ retcode: 0, msg: "success", data: { status: 2, bot_appid: "qr-profile-delay-app", bot_encrypt_secret: encryptedSecret("qr-profile-delay-secret", qrTaskKey) } });
      }
      if (url.pathname === "/app/getAppAccessToken") return Response.json({ access_token: "access-token", expires_in: 3600 });
      if (url.pathname === "/users/@me") return Response.json({ err_code: 40011034, message: "bot profile is propagating" }, { status: 400 });
      throw new Error(`Unexpected QQ URL: ${url}`);
    });
    const admin = sessionModule.authenticate("qr-admin@test.local", "admin-password-2026")!;
    const session = botQrModule.startQrSession(admin, { environment: "production", connectionMode: "websocket" });
    const completed = await waitForStatus(session.id, "completed", 500);
    expect(completed.botId).toBeTruthy();
    const bot = databaseModule.getDatabase().prepare("SELECT name, app_id FROM bots WHERE id = ?").get(completed.botId) as { name: string; app_id: string };
    expect(bot.app_id).toBe("qr-profile-delay-app");
    expect(bot.name).toContain("QQ 机器人");
  });

  it("normalizes a numeric bot_appid returned by QQ", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname === "q.qq.com" && url.pathname === "/lite/create_bind_task") {
        const request = input instanceof Request ? await input.clone().json() : JSON.parse(String(init?.body || "{}"));
        qrTaskKey = typeof request.key === "string" ? request.key : "";
        return Response.json({ retcode: 0, msg: "success", data: { task_id: "qr-numeric-app-task" } });
      }
      if (url.hostname === "q.qq.com" && url.pathname === "/lite/poll_bind_result") {
        return Response.json({ retcode: 0, msg: "success", data: { status: 2, bot_appid: 987654321, bot_encrypt_secret: encryptedSecret("qr-numeric-app-secret", qrTaskKey) } });
      }
      if (url.pathname === "/app/getAppAccessToken") return Response.json({ access_token: "access-token", expires_in: 3600 });
      if (url.pathname === "/users/@me") return Response.json({ id: "qr-numeric-bot", username: "数字 AppID 机器人" });
      throw new Error(`Unexpected QQ URL: ${url}`);
    });
    const admin = sessionModule.authenticate("qr-admin@test.local", "admin-password-2026")!;
    const session = botQrModule.startQrSession(admin, { environment: "production", connectionMode: "webhook" });
    const completed = await waitForStatus(session.id, "completed", 500);
    const bot = databaseModule.getDatabase().prepare("SELECT app_id FROM bots WHERE id = ?").get(completed.botId) as { app_id: string };
    expect(bot.app_id).toBe("987654321");
  });

  it("fails QR import when the Gateway never becomes online", async () => {
    vi.useFakeTimers();
    vi.spyOn(gatewayManagerModule.gatewayManager, "connectPending").mockResolvedValue({
      connected: false,
      reconnecting: true,
      owned: true,
      shardCount: 1,
      onlineShards: 0,
      lastAckAt: null,
    });
    vi.spyOn(gatewayManagerModule.gatewayManager, "waitForConnected").mockResolvedValue(false);
    const admin = sessionModule.authenticate("qr-admin@test.local", "admin-password-2026")!;
    qrPollResponse = { status: 2, bot_appid: "qr-offline-gateway-app", bot_encrypt_secret: "", user_openid: "" };
    const session = botQrModule.startQrSession(admin, { environment: "production", connectionMode: "websocket" });
    await vi.advanceTimersByTimeAsync(76_000);
    expect(botQrModule.getQrSession(admin, session.id)).toMatchObject({ status: "failed", errorCode: "QQ_BOT_QR_GATEWAY_NOT_ONLINE", botId: null });
    expect(databaseModule.getDatabase().prepare("SELECT COUNT(*) AS count FROM bots WHERE app_id = ?").get("qr-offline-gateway-app")).toEqual({ count: 0 });
    expect(databaseModule.getDatabase().prepare("SELECT COUNT(*) AS count FROM gateway_leases").get()).toEqual({ count: 0 });
  });

  it("accepts string completion states and retries QQ poll rate limits", async () => {
    let polls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname === "q.qq.com" && url.pathname === "/lite/create_bind_task") {
        const request = input instanceof Request ? await input.clone().json() : JSON.parse(String(init?.body || "{}"));
        qrTaskKey = typeof request.key === "string" ? request.key : "";
        return Response.json({ retcode: "0", msg: "success", data: { task_id: "qr-test-task" } });
      }
      if (url.hostname === "q.qq.com" && url.pathname === "/lite/poll_bind_result") {
        polls += 1;
        if (polls === 1) return Response.json({ retcode: 30012, msg: "轮询频率过高" });
        return Response.json({ retcode: "0", msg: "success", data: { status: "COMPLETED", bot_appid: "qr-string-status", bot_encrypt_secret: encryptedSecret("qr-string-secret", qrTaskKey) } });
      }
      if (url.pathname === "/app/getAppAccessToken") return Response.json({ access_token: "access-token", expires_in: 3600 });
      if (url.pathname === "/users/@me") return Response.json({ id: "qq-string-status", username: "字符串状态机器人" });
      throw new Error(`Unexpected QQ URL: ${url}`);
    });
    const admin = sessionModule.authenticate("qr-admin@test.local", "admin-password-2026")!;
    const session = botQrModule.startQrSession(admin, { environment: "production", connectionMode: "websocket" });
    const completed = await waitForStatus(session.id, "completed", 500);
    expect(completed.botId).toBeTruthy();
    expect(polls).toBe(2);
  });

  it("keeps polling when the QQ bind handoff returns a transient API error", async () => {
    let polls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname === "q.qq.com" && url.pathname === "/lite/create_bind_task") {
        const request = input instanceof Request ? await input.clone().json() : JSON.parse(String(init?.body || "{}"));
        qrTaskKey = typeof request.key === "string" ? request.key : "";
        return Response.json({ retcode: 0, msg: "success", data: { task_id: "qr-transient-task" } });
      }
      if (url.hostname === "q.qq.com" && url.pathname === "/lite/poll_bind_result") {
        polls += 1;
        if (polls === 1) return Response.json({ retcode: 30011, msg: "绑定处理中" });
        return Response.json({ retcode: 0, msg: "success", data: { status: 2, bot_appid: "qr-transient-app", bot_encrypt_secret: encryptedSecret("qr-transient-secret", qrTaskKey) } });
      }
      if (url.pathname === "/app/getAppAccessToken") return Response.json({ access_token: "access-token", expires_in: 3600 });
      if (url.pathname === "/users/@me") return Response.json({ id: "qr-transient-bot", username: "临时错误后完成" });
      throw new Error(`Unexpected QQ URL: ${url}`);
    });
    const admin = sessionModule.authenticate("qr-admin@test.local", "admin-password-2026")!;
    const session = botQrModule.startQrSession(admin, { environment: "production", connectionMode: "websocket" });
    const completed = await waitForStatus(session.id, "completed", 700);
    expect(completed.botId).toBeTruthy();
    expect(polls).toBe(2);
  });

  it("records QR API failures instead of leaving a generic import error", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname === "q.qq.com" && url.pathname === "/lite/create_bind_task") {
        return new Response("upstream unavailable", { status: 503 });
      }
      throw new Error(`Unexpected QQ URL: ${url}`);
    });
    const admin = sessionModule.authenticate("qr-admin@test.local", "admin-password-2026")!;
    const session = botQrModule.startQrSession(admin, { environment: "production", connectionMode: "websocket" });
    await expect(waitForStatus(session.id, "failed")).resolves.toMatchObject({ errorCode: "QQ_BOT_QR_HTTP_503" });
  });

  it("cancels an active session and prevents a second active session for the user", () => {
    const admin = sessionModule.authenticate("qr-admin@test.local", "admin-password-2026")!;
    const session = botQrModule.startQrSession(admin, { environment: "production", connectionMode: "webhook" });
    expect(() => botQrModule.startQrSession(admin, { environment: "sandbox", connectionMode: "websocket" })).toThrow("QQ_BOT_QR_ALREADY_ACTIVE");
    expect(botQrModule.cancelQrSession(admin, session.id)).toMatchObject({ status: "cancelled", errorCode: "QQ_BOT_QR_CANCELLED" });
  });

  it("expires a session once its deadline has passed", () => {
    const admin = sessionModule.authenticate("qr-admin@test.local", "admin-password-2026")!;
    const session = botQrModule.startQrSession(admin, { environment: "sandbox", connectionMode: "websocket" });
    databaseModule.getDatabase().prepare("UPDATE qq_bot_qr_sessions SET expires_at = ? WHERE id = ?").run(Date.now() - 1, session.id);
    expect(botQrModule.getQrSession(admin, session.id)).toMatchObject({ status: "expired", errorCode: "QQ_BOT_QR_EXPIRED" });
  });
});
