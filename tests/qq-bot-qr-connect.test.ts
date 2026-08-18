import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const startQrConnectMock = vi.hoisted(() => vi.fn());
vi.mock("@tencent-connect/qqbot-connector", () => ({ startQrConnect: startQrConnectMock }));

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "starbot-qq-bot-qr-test-"));
const databasePath = path.join(temporaryDirectory, "starbot.db");
let databaseModule: typeof import("@/lib/database");
let botQrModule: typeof import("@/lib/qq-bot-qr-connect");
let botServiceModule: typeof import("@/lib/bot-service");
let cryptoModule: typeof import("@/lib/crypto-vault");
let sessionModule: typeof import("@/lib/session");
let callbacks: { onSuccess: (credentials: Array<{ appId: string; appSecret: string }>) => void; onFailure: (error: Error) => void; onQrDisplayed: (url: string) => void; onQrExpired: () => void };

beforeAll(async () => {
  process.env.DATABASE_PATH = databasePath;
  process.env.BOOTSTRAP_ADMIN_EMAIL = "qr-admin@test.local";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "admin-password-2026";
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 41).toString("base64");
  [databaseModule, botQrModule, botServiceModule, cryptoModule, sessionModule] = await Promise.all([
    import("@/lib/database"),
    import("@/lib/qq-bot-qr-connect"),
    import("@/lib/bot-service"),
    import("@/lib/crypto-vault"),
    import("@/lib/session"),
  ]);
  databaseModule.getDatabase();
});

beforeEach(() => {
  callbacks = undefined as never;
  startQrConnectMock.mockImplementation((nextCallbacks: typeof callbacks) => {
    callbacks = nextCallbacks;
    return vi.fn();
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.pathname === "/app/getAppAccessToken") return Response.json({ access_token: "access-token", expires_in: 3600 });
    if (url.pathname === "/users/@me") return Response.json({ id: "qq-bot-id", username: "扫码机器人" });
    throw new Error(`Unexpected QQ URL: ${url}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  const state = globalThis as typeof globalThis & { __starbotDatabase?: { close(): void } };
  state.__starbotDatabase?.close();
  delete state.__starbotDatabase;
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

async function waitForStatus(sessionId: string, status: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
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
    const session = botQrModule.startQrSession(admin, { environment: "sandbox", connectionMode: "websocket" });
    expect(session.status).toBe("pending");
    callbacks.onQrDisplayed("https://q.qq.com/qqbot/openclaw/connect.html?task=qr-secret");
    expect(botQrModule.getQrSession(admin, session.id)).toMatchObject({ status: "scanning", qrRevision: 1 });

    callbacks.onSuccess([{ appId: "qr-app-id", appSecret: "qr-app-secret" }]);
    const completed = await waitForStatus(session.id, "completed");
    expect(completed.botId).toBeTruthy();
    const bot = databaseModule.getDatabase().prepare("SELECT app_id, client_secret_cipher FROM bots WHERE id = ?").get(completed.botId) as { app_id: string; client_secret_cipher: string };
    expect(bot.app_id).toBe("qr-app-id");
    expect(cryptoModule.decryptSecret(bot.client_secret_cipher)).toBe("qr-app-secret");
    expect(botServiceModule.listBots(admin)).toHaveLength(1);
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
