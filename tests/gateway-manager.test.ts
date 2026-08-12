import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "starbot-gateway-test-"));
const databasePath = path.join(temporaryDirectory, "starbot.db");

let botId = "";
let databaseModule: typeof import("@/lib/database");
let gatewayCoordinationModule: typeof import("@/lib/gateway-coordination");
let GatewayManager: typeof import("@/lib/gateway-manager").GatewayManager;

class MemorySocket extends EventEmitter {
  readonly sent: string[] = [];
  readyState: number = WebSocket.OPEN;

  constructor(readonly url: string) {
    super();
  }

  send(data: WebSocket.Data) {
    this.sent.push(data.toString());
  }

  close(code = 1000, reason = "") {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.emit("close", code, Buffer.from(reason));
  }

  receive(payload: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(payload)), false);
  }
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

beforeAll(async () => {
  process.env.DATABASE_PATH = databasePath;
  process.env.BOOTSTRAP_ADMIN_EMAIL = "admin@gateway.test";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "admin-password-2026";
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  [databaseModule, gatewayCoordinationModule, { GatewayManager }] = await Promise.all([
    import("@/lib/database"),
    import("@/lib/gateway-coordination"),
    import("@/lib/gateway-manager"),
  ]);

  const database = databaseModule.getDatabase();
  const admin = database.prepare("SELECT id FROM users WHERE email = ?").get("admin@gateway.test") as { id: string };
  botId = randomUUID();
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO bots (id, user_id, name, app_id, client_secret_cipher, environment, connection_mode, intents, status, auto_connect, created_at, updated_at)
    VALUES (?, ?, 'Gateway Protocol Bot', 'gateway-test-app', 'unused-in-test', 'sandbox', 'websocket', 33554432, 'offline', 0, ?, ?)
  `).run(botId, admin.id, now, now);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  const state = globalThis as typeof globalThis & {
    __starbotClients?: Map<string, unknown>;
    __starbotGateways?: Map<string, unknown>;
    __starbotGatewayBootstrapTimers?: Map<string, NodeJS.Timeout>;
  };
  state.__starbotClients?.delete(botId);
  state.__starbotGateways?.clear();
  for (const timer of state.__starbotGatewayBootstrapTimers?.values() || []) clearTimeout(timer);
  state.__starbotGatewayBootstrapTimers?.clear();
  databaseModule.getDatabase().prepare("DELETE FROM gateway_leases WHERE bot_id = ?").run(botId);
  databaseModule.getDatabase().prepare("DELETE FROM gateway_shard_sessions WHERE bot_id = ?").run(botId);
  databaseModule.getDatabase().prepare("UPDATE bots SET auto_connect = 0, status = 'offline' WHERE id = ?").run(botId);
});

afterAll(() => {
  const state = globalThis as typeof globalThis & { __starbotDatabase?: { close(): void }; __starbotClients?: Map<string, unknown> };
  state.__starbotClients?.delete(botId);
  state.__starbotDatabase?.close();
  delete state.__starbotDatabase;
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("Gateway protocol", () => {
  it("identifies, heartbeats, resumes, clears invalid sessions, and stops on fatal closes", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const sockets: MemorySocket[] = [];
    const fakeClient = {
      getGatewayInfo: vi.fn(async () => ({
        body: {
          url: "wss://gateway.test.example/",
          shards: 1,
          session_start_limit: { total: 100, remaining: 100, reset_after: 0, max_concurrency: 1 },
        },
        traceId: "gateway-test-trace",
      })),
      getAccessToken: vi.fn(async () => "gateway-access-token"),
    };
    const state = globalThis as typeof globalThis & { __starbotClients?: Map<string, unknown> };
    state.__starbotClients = new Map([[botId, fakeClient]]);
    const manager = new GatewayManager((url) => {
      const socket = new MemorySocket(url);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    });

    await manager.connect(botId, true);
    await settle();
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe("wss://gateway.test.example/");

    sockets[0].receive({ op: 10, d: { heartbeat_interval: 100 } });
    await settle();
    expect(JSON.parse(sockets[0].sent[0])).toEqual({
      op: 2,
      d: {
        token: "QQBot gateway-access-token",
        intents: 1 << 25,
        shard: [0, 1],
        properties: { $os: process.platform, $browser: "starbot", $device: "starbot" },
      },
    });

    sockets[0].receive({ op: 0, t: "READY", s: 42, d: { session_id: "session-42" } });
    await settle();
    expect(gatewayCoordinationModule.listGatewayShardSessions(botId)[0]).toMatchObject({
      status: "online",
      sessionId: "session-42",
      sequence: 42,
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(JSON.parse(sockets[0].sent.at(-1)!)).toEqual({ op: 1, d: 42 });
    sockets[0].receive({ op: 11 });
    await settle();
    expect(gatewayCoordinationModule.listGatewayShardSessions(botId)[0].lastAckAt).not.toBeNull();

    sockets[0].receive({ op: 7 });
    await settle();
    await vi.advanceTimersByTimeAsync(800);
    await settle();
    expect(sockets).toHaveLength(2);
    sockets[1].receive({ op: 10, d: { heartbeat_interval: 100 } });
    await settle();
    expect(JSON.parse(sockets[1].sent[0])).toEqual({
      op: 6,
      d: { token: "QQBot gateway-access-token", session_id: "session-42", seq: 42 },
    });
    sockets[1].receive({ op: 11 });
    await settle();

    sockets[0].receive({ op: 0, t: "C2C_MESSAGE_CREATE", s: 999, d: { id: "stale-event" } });
    await settle();
    expect(gatewayCoordinationModule.listGatewayShardSessions(botId)[0].sequence).toBe(42);

    sockets[1].receive({ op: 9 });
    await settle();
    expect(gatewayCoordinationModule.listGatewayShardSessions(botId)[0]).toMatchObject({ sessionId: null, sequence: null });
    await vi.advanceTimersByTimeAsync(800);
    await settle();
    expect(sockets).toHaveLength(3);
    sockets[2].receive({ op: 10, d: { heartbeat_interval: 100 } });
    await settle();
    expect(sockets[2].sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    expect(JSON.parse(sockets[2].sent[0]).op).toBe(2);

    sockets[2].close(4013, "invalid intents");
    await settle();
    expect(manager.status(botId).owned).toBe(false);
    expect((databaseModule.getDatabase().prepare("SELECT auto_connect FROM bots WHERE id = ?").get(botId) as { auto_connect: number }).auto_connect).toBe(0);
    expect(gatewayCoordinationModule.listGatewayShardSessions(botId).every((session) => session.status === "offline")).toBe(true);
  });
});
