import "server-only";
import WebSocket, { type RawData } from "ws";
import { getBotGatewayConfig, listAutoConnectBotIds, recordEvent, setBotAutoConnect } from "@/lib/bot-service";
import { ingestQQEvent, type QQEventEnvelope } from "@/lib/event-ingestion";
import {
  acquireGatewayLease,
  clearGatewayShardSession,
  gatewayLeaseTtlMs,
  listGatewayShardSessions,
  markGatewayShardsOffline,
  prepareGatewayShards,
  pruneGatewayRuntimeData,
  releaseGatewayLease,
  renewGatewayLease,
  revokeGatewayLease,
  updateGatewayShardSession,
} from "@/lib/gateway-coordination";
import type { QQGatewayInfo } from "@/lib/qq-api";

type ShardRuntime = {
  shardId: number;
  shardCount: number;
  socket?: WebSocket;
  heartbeat?: NodeJS.Timeout;
  reconnect?: NodeJS.Timeout;
  stopped: boolean;
  attempts: number;
  lastAckAt?: number;
  lastHeartbeatAt?: number;
};

type BotGatewayRuntime = {
  botId: string;
  gatewayUrl: string;
  shards: Map<number, ShardRuntime>;
  leaseTimer?: NodeJS.Timeout;
  stopped: boolean;
  maxConcurrency: number;
  identifyTimestamps: number[];
  identifyChain: Promise<void>;
};

type GatewayGlobal = typeof globalThis & {
  __starbotGateways?: Map<string, BotGatewayRuntime>;
  __starbotGatewayBootstrapTimers?: Map<string, NodeJS.Timeout>;
};

export type GatewaySocketFactory = (url: string) => WebSocket;

function states() {
  const globalState = globalThis as GatewayGlobal;
  globalState.__starbotGateways ||= new Map();
  return globalState.__starbotGateways;
}

function bootstrapTimers() {
  const globalState = globalThis as GatewayGlobal;
  globalState.__starbotGatewayBootstrapTimers ||= new Map();
  return globalState.__starbotGatewayBootstrapTimers;
}

function validateGatewayInfo(gateway: QQGatewayInfo) {
  const url = new URL(gateway.url);
  if (url.protocol !== "wss:") throw new Error("GATEWAY_URL_INVALID");
  const shardCount = Number(gateway.shards);
  const remaining = Number(gateway.session_start_limit?.remaining);
  const maxConcurrency = Number(gateway.session_start_limit?.max_concurrency);
  if (!Number.isSafeInteger(shardCount) || shardCount < 1 || shardCount > 1000) throw new Error("GATEWAY_SHARD_COUNT_INVALID");
  if (!Number.isSafeInteger(remaining) || remaining < 0) throw new Error("GATEWAY_SESSION_LIMIT_INVALID");
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1) throw new Error("GATEWAY_CONCURRENCY_INVALID");
  return { gatewayUrl: url.toString(), shardCount, maxConcurrency };
}

function shouldRetryClose(code: number) {
  if ([4001, 4002, 4010, 4011, 4012, 4013, 4014, 4914, 4915].includes(code)) return false;
  return true;
}

function shouldClearSession(code: number) {
  return code === 4006 || code === 4007 || (code >= 4900 && code <= 4913);
}

export class GatewayManager {
  constructor(private readonly socketFactory: GatewaySocketFactory = (url) => new WebSocket(url)) {}

  status(botId: string) {
    const runtime = states().get(botId);
    const sessions = listGatewayShardSessions(botId);
    const onlineShards = sessions.filter((session) => session.status === "online").length;
    const reconnecting = sessions.some((session) => session.status === "reconnecting") || Array.from(runtime?.shards.values() || []).some((shard) => Boolean(shard.reconnect));
    return {
      connected: sessions.length > 0 && onlineShards === sessions.length,
      reconnecting,
      owned: Boolean(runtime && !runtime.stopped),
      shardCount: sessions.length,
      onlineShards,
      lastAckAt: Math.max(0, ...sessions.map((session) => session.lastAckAt || 0)) || null,
    };
  }

  async connect(botId: string, persist = true) {
    const pendingBootstrap = bootstrapTimers().get(botId);
    if (pendingBootstrap) clearTimeout(pendingBootstrap);
    bootstrapTimers().delete(botId);
    this.stopLocal(botId, true);
    if (persist) setBotAutoConnect(botId, true);
    if (!acquireGatewayLease(botId)) {
      scheduleLeaseAcquisition(botId);
      if (persist) return this.status(botId);
      throw new Error("GATEWAY_ALREADY_OWNED");
    }
    try {
      const config = getBotGatewayConfig(botId);
      const { body: gateway } = await config.client.getGatewayInfo();
      const connection = validateGatewayInfo(gateway);
      const sessions = prepareGatewayShards(botId, connection.shardCount);
      const identifyCount = sessions.filter((session) => !session.sessionId).length;
      if (gateway.session_start_limit.remaining < identifyCount) {
        markGatewayShardsOffline(botId);
        throw new Error("GATEWAY_SESSION_LIMIT_EXCEEDED");
      }
      const runtime: BotGatewayRuntime = {
        botId,
        gatewayUrl: connection.gatewayUrl,
        maxConcurrency: connection.maxConcurrency,
        shards: new Map(sessions.map((session) => [session.shardId, {
          shardId: session.shardId,
          shardCount: session.shardCount,
          stopped: false,
          attempts: 0,
          lastAckAt: session.lastAckAt || undefined,
        }])),
        stopped: false,
        identifyTimestamps: [],
        identifyChain: Promise.resolve(),
      };
      states().set(botId, runtime);
      runtime.leaseTimer = setInterval(() => {
        if (!renewGatewayLease(botId)) this.stopForLostLease(runtime);
      }, Math.floor(gatewayLeaseTtlMs / 3));
      runtime.leaseTimer.unref?.();
      void this.startShardBatches(runtime).catch((error) => {
        if (runtime.stopped) return;
        recordEvent(botId, { type: "WS_SHARD_START_FAILED", scene: "系统", status: "failed", content: error instanceof Error ? error.message : "unknown error", payload: {} });
      });
      return this.status(botId);
    } catch (error) {
      releaseGatewayLease(botId);
      markGatewayShardsOffline(botId);
      if (persist && !(error instanceof Error && error.message === "BOT_NOT_FOUND")) {
        recordEvent(botId, { type: "WS_CONNECT_RETRY", scene: "系统", status: "warning", content: error instanceof Error ? error.message : "unknown error", payload: {} });
        scheduleConnectionBootstrap(botId);
        return this.status(botId);
      }
      throw error;
    }
  }

  disconnect(botId: string, markStopped = true, persist = false) {
    void markStopped;
    this.stopLocal(botId, true);
    const pendingBootstrap = bootstrapTimers().get(botId);
    if (pendingBootstrap) clearTimeout(pendingBootstrap);
    bootstrapTimers().delete(botId);
    if (persist) {
      setBotAutoConnect(botId, false);
      revokeGatewayLease(botId);
    } else {
      releaseGatewayLease(botId);
    }
    markGatewayShardsOffline(botId);
  }

  private stopLocal(botId: string, closeSockets: boolean) {
    const runtime = states().get(botId);
    if (!runtime) return;
    runtime.stopped = true;
    if (runtime.leaseTimer) clearInterval(runtime.leaseTimer);
    for (const shard of runtime.shards.values()) {
      shard.stopped = true;
      if (shard.heartbeat) clearInterval(shard.heartbeat);
      if (shard.reconnect) clearTimeout(shard.reconnect);
      if (closeSockets) shard.socket?.close(1000, "gateway stopped");
    }
    states().delete(botId);
  }

  private stopForLostLease(runtime: BotGatewayRuntime) {
    if (runtime.stopped) return;
    recordEvent(runtime.botId, { type: "WS_LEASE_LOST", scene: "系统", status: "warning", content: "Gateway ownership lease lost", payload: {} });
    this.stopLocal(runtime.botId, true);
    markGatewayShardsOffline(runtime.botId);
    if (listAutoConnectBotIds().includes(runtime.botId)) scheduleLeaseAcquisition(runtime.botId);
  }

  private async startShardBatches(runtime: BotGatewayRuntime) {
    const shards = Array.from(runtime.shards.values()).sort((left, right) => left.shardId - right.shardId);
    for (let index = 0; index < shards.length; index += runtime.maxConcurrency) {
      if (runtime.stopped) return;
      const batch = shards.slice(index, index + runtime.maxConcurrency);
      const results = await Promise.allSettled(batch.map((shard) => this.openShard(runtime, shard)));
      results.forEach((result, batchIndex) => {
        if (result.status === "fulfilled") return;
        const shard = batch[batchIndex];
        recordEvent(runtime.botId, { type: "WS_SHARD_START_FAILED", scene: "系统", status: "warning", content: result.reason instanceof Error ? result.reason.message : "unknown error", payload: { shardId: shard.shardId } });
        updateGatewayShardSession(runtime.botId, shard.shardId, { status: "reconnecting" });
        this.scheduleReconnect(runtime, shard);
      });
      if (index + runtime.maxConcurrency < shards.length) await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }

  private async openShard(runtime: BotGatewayRuntime, shard: ShardRuntime) {
    if (runtime.stopped || shard.stopped) return;
    const config = getBotGatewayConfig(runtime.botId);
    const accessToken = await config.client.getAccessToken();
    const socket = this.socketFactory(runtime.gatewayUrl);
    shard.socket = socket;
    updateGatewayShardSession(runtime.botId, shard.shardId, { status: shard.attempts ? "reconnecting" : "connecting" });

    socket.on("message", (raw) => void this.onMessage(runtime, shard, socket, raw, accessToken, config.intents).catch((error) => {
      recordEvent(runtime.botId, { type: "WS_PAYLOAD_ERROR", scene: "系统", status: "failed", content: error instanceof Error ? error.message : "unknown error", payload: { shardId: shard.shardId } });
      socket.close(4002, "payload handling failed");
    }));
    socket.on("error", (error) => recordEvent(runtime.botId, { type: "WS_ERROR", scene: "系统", status: "failed", content: error.message, payload: { shardId: shard.shardId, message: error.message } }));
    socket.on("close", (code, reason) => this.onClose(runtime, shard, socket, code, reason.toString()));
  }

  private onClose(runtime: BotGatewayRuntime, shard: ShardRuntime, socket: WebSocket, code: number, reason: string) {
    if (shard.socket !== socket) return;
    if (shard.heartbeat) clearInterval(shard.heartbeat);
    shard.heartbeat = undefined;
    shard.socket = undefined;
    if (states().get(runtime.botId) !== runtime) return;
    recordEvent(runtime.botId, { type: "WS_CLOSE", scene: "系统", status: code === 1000 ? "success" : "warning", content: `${code} ${reason}`, payload: { code, reason, shardId: shard.shardId } });
    if (shouldClearSession(code)) clearGatewayShardSession(runtime.botId, shard.shardId);
    else updateGatewayShardSession(runtime.botId, shard.shardId, { status: runtime.stopped || shard.stopped ? "offline" : "reconnecting" });
    if (runtime.stopped || shard.stopped) return;
    if (!shouldRetryClose(code)) {
      recordEvent(runtime.botId, { type: "WS_FATAL_CLOSE", scene: "系统", status: "failed", content: `${code} ${reason}`, payload: { code, reason, shardId: shard.shardId } });
      setBotAutoConnect(runtime.botId, false);
      this.stopLocal(runtime.botId, true);
      releaseGatewayLease(runtime.botId);
      markGatewayShardsOffline(runtime.botId);
      return;
    }
    this.scheduleReconnect(runtime, shard);
  }

  private async onMessage(runtime: BotGatewayRuntime, shard: ShardRuntime, socket: WebSocket, raw: RawData, accessToken: string, intents: number) {
    if (states().get(runtime.botId) !== runtime || shard.socket !== socket) return;
    const rawBody = raw.toString();
    const payload = JSON.parse(rawBody) as QQEventEnvelope;
    if (payload.s !== undefined) updateGatewayShardSession(runtime.botId, shard.shardId, { status: "online", sequence: payload.s });

    if (payload.op === 10) {
      const interval = Number((payload.d as { heartbeat_interval?: number })?.heartbeat_interval);
      if (!Number.isFinite(interval) || interval <= 0) throw new Error("Gateway returned an invalid heartbeat interval");
      const session = listGatewayShardSessions(runtime.botId).find((item) => item.shardId === shard.shardId);
      const canResume = Boolean(session?.sessionId && session.sequence !== null);
      if (!canResume) await this.waitForIdentifySlot(runtime);
      if (runtime.stopped || shard.stopped || shard.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
      const authPayload = canResume
        ? { op: 6, d: { token: `QQBot ${accessToken}`, session_id: session!.sessionId, seq: session!.sequence } }
        : { op: 2, d: { token: `QQBot ${accessToken}`, intents, shard: [shard.shardId, shard.shardCount], properties: { $os: process.platform, $browser: "starbot", $device: "starbot" } } };
      socket.send(JSON.stringify(authPayload));
      shard.lastAckAt = Date.now();
      if (shard.heartbeat) clearInterval(shard.heartbeat);
      shard.heartbeat = setInterval(() => {
        if (shard.lastHeartbeatAt && shard.lastAckAt && shard.lastAckAt < shard.lastHeartbeatAt && Date.now() - shard.lastHeartbeatAt > interval * 1.5) {
          recordEvent(runtime.botId, { type: "WS_HEARTBEAT_TIMEOUT", scene: "系统", status: "failed", content: "Gateway heartbeat ACK timeout", payload: { interval, shardId: shard.shardId } });
          socket.close(4009, "heartbeat ack timeout");
          return;
        }
        if (socket.readyState === WebSocket.OPEN) {
          const current = listGatewayShardSessions(runtime.botId).find((item) => item.shardId === shard.shardId);
          socket.send(JSON.stringify({ op: 1, d: current?.sequence ?? null }));
          shard.lastHeartbeatAt = Date.now();
        }
      }, interval);
      shard.heartbeat.unref?.();
      return;
    }

    if (payload.op === 11) {
      shard.lastAckAt = Date.now();
      shard.attempts = 0;
      updateGatewayShardSession(runtime.botId, shard.shardId, { status: "online", lastAckAt: shard.lastAckAt });
      return;
    }
    if (payload.op === 7) { socket.close(4000, "server requested reconnect"); return; }
    if (payload.op === 9) { clearGatewayShardSession(runtime.botId, shard.shardId); socket.close(4006, "invalid session"); return; }

    if (payload.op === 0 && payload.t) {
      if (payload.t === "READY") {
        const sessionId = (payload.d as { session_id?: string })?.session_id || null;
        updateGatewayShardSession(runtime.botId, shard.shardId, { status: "online", sessionId, sequence: payload.s });
      } else {
        updateGatewayShardSession(runtime.botId, shard.shardId, { status: "online", sequence: payload.s });
      }
      await ingestQQEvent(runtime.botId, "gateway", payload, rawBody);
    }
  }

  private scheduleReconnect(runtime: BotGatewayRuntime, shard: ShardRuntime) {
    if (runtime.stopped || shard.stopped || shard.reconnect) return;
    shard.attempts += 1;
    const baseDelay = Math.min(30_000, 1000 * 2 ** Math.min(5, shard.attempts - 1));
    const delay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
    shard.reconnect = setTimeout(() => {
      shard.reconnect = undefined;
      void this.openShard(runtime, shard).catch((error) => {
        if (runtime.stopped || shard.stopped) return;
        if (error instanceof Error && error.message === "BOT_NOT_FOUND") {
          shard.stopped = true;
          return;
        }
        recordEvent(runtime.botId, { type: "WS_RECONNECT_FAILED", scene: "系统", status: "failed", content: error instanceof Error ? error.message : "unknown error", payload: { shardId: shard.shardId } });
        this.scheduleReconnect(runtime, shard);
      });
    }, delay);
    shard.reconnect.unref?.();
  }

  private waitForIdentifySlot(runtime: BotGatewayRuntime) {
    const wait = runtime.identifyChain.then(async () => {
      while (!runtime.stopped) {
        const now = Date.now();
        runtime.identifyTimestamps = runtime.identifyTimestamps.filter((timestamp) => timestamp > now - 5_000);
        if (runtime.identifyTimestamps.length < runtime.maxConcurrency) {
          runtime.identifyTimestamps.push(now);
          return;
        }
        const delay = Math.max(50, runtime.identifyTimestamps[0] + 5_000 - now);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    });
    runtime.identifyChain = wait.catch(() => undefined);
    return wait;
  }
}

export const gatewayManager = new GatewayManager();

export async function restoreGatewayConnections() {
  pruneGatewayRuntimeData();
  const botIds = listAutoConnectBotIds();
  const results = await Promise.allSettled(botIds.map((botId) => gatewayManager.connect(botId, false)));
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      const reason = result.reason instanceof Error ? result.reason.message : "unknown error";
      recordEvent(botIds[index], { type: reason === "GATEWAY_ALREADY_OWNED" ? "WS_OWNED_BY_ANOTHER_INSTANCE" : "WS_RESTORE_FAILED", scene: "系统", status: reason === "GATEWAY_ALREADY_OWNED" ? "warning" : "failed", content: reason, payload: {} });
      if (reason === "GATEWAY_ALREADY_OWNED") {
        scheduleLeaseAcquisition(botIds[index]);
      } else if (reason !== "BOT_NOT_FOUND") {
        scheduleConnectionBootstrap(botIds[index]);
      }
    }
  });
}

function scheduleLeaseAcquisition(botId: string) {
  if (bootstrapTimers().has(botId)) return;
  const retry = setTimeout(() => {
    bootstrapTimers().delete(botId);
    if (!listAutoConnectBotIds().includes(botId)) return;
    void gatewayManager.connect(botId, false).catch((error) => {
      if (error instanceof Error && error.message === "GATEWAY_ALREADY_OWNED") scheduleLeaseAcquisition(botId);
      else if (!(error instanceof Error && error.message === "BOT_NOT_FOUND")) scheduleConnectionBootstrap(botId);
    });
  }, gatewayLeaseTtlMs + Math.round(Math.random() * 5_000));
  retry.unref?.();
  bootstrapTimers().set(botId, retry);
}

function scheduleConnectionBootstrap(botId: string) {
  if (bootstrapTimers().has(botId)) return;
  const retry = setTimeout(() => {
    bootstrapTimers().delete(botId);
    if (!listAutoConnectBotIds().includes(botId)) return;
    void gatewayManager.connect(botId, false).catch((error) => {
      if (!(error instanceof Error && error.message === "BOT_NOT_FOUND")) scheduleConnectionBootstrap(botId);
    });
  }, 5_000 + Math.round(Math.random() * 5_000));
  retry.unref?.();
  bootstrapTimers().set(botId, retry);
}
