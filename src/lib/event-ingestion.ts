import "server-only";
import { createHash } from "node:crypto";
import { recordEvent } from "@/lib/bot-service";
import { claimEventReceipt } from "@/lib/gateway-coordination";
import { dispatchPlugins } from "@/lib/plugin-service";

export type QQEventEnvelope = { op: number; d?: unknown; s?: number; t?: string; id?: string };

function eventScene(eventType: string) {
  if (eventType.startsWith("GROUP")) return "群聊";
  if (eventType.startsWith("C2C")) return "单聊";
  if (eventType.startsWith("DIRECT") || eventType.includes("GUILD") || eventType.startsWith("AT_MESSAGE")) return "频道";
  return "系统";
}

function eventContent(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  if (typeof record.content === "string") return record.content;
  if (record.message && typeof record.message === "object" && typeof (record.message as Record<string, unknown>).content === "string") {
    return String((record.message as Record<string, unknown>).content);
  }
  return "";
}

export function eventReceiptKey(payload: QQEventEnvelope, rawBody?: string) {
  const data = payload.d && typeof payload.d === "object" ? payload.d as Record<string, unknown> : null;
  const stableId = payload.id || (typeof data?.id === "string" ? data.id : "");
  if (stableId) return `${payload.t || "EVENT"}:${stableId}`;
  if (rawBody) return createHash("sha256").update(rawBody).digest("hex");
  return `${payload.t || "EVENT"}:sequence:${payload.s ?? "unknown"}`;
}

export async function ingestQQEvent(botId: string, source: "gateway" | "qq_webhook", payload: QQEventEnvelope, rawBody?: string) {
  if (payload.op !== 0 || !payload.t) return { accepted: false, reason: "NOT_DISPATCH_EVENT" as const };
  const key = eventReceiptKey(payload, rawBody);
  if (!claimEventReceipt(botId, source, key)) return { accepted: false, reason: "DUPLICATE" as const };
  recordEvent(botId, {
    type: payload.t,
    scene: eventScene(payload.t),
    content: eventContent(payload.d),
    payload,
  });
  await dispatchPlugins(botId, payload.t, payload.d);
  return { accepted: true, eventKey: key };
}
