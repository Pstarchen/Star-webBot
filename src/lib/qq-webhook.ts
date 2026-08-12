import "server-only";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { decryptSecret } from "@/lib/crypto-vault";
import { ingestQQEvent, type QQEventEnvelope } from "@/lib/event-ingestion";
import { getBotRowInternal, markBotWebhookActive } from "@/lib/bot-service";
import { deriveQQWebhookToken, qqWebhookTokenMatches } from "@/lib/qq-webhook-token";

const ED25519_PKCS8_SEED_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function secretSeed(secret: string) {
  let seed = secret;
  while (Buffer.byteLength(seed) < 32) seed += seed;
  return Buffer.from(seed).subarray(0, 32);
}

function privateKeyFromSecret(secret: string) {
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_SEED_PREFIX, secretSeed(secret)]),
    format: "der",
    type: "pkcs8",
  });
}

export function signQQWebhookChallenge(secret: string, eventTimestamp: string, plainToken: string) {
  return sign(null, Buffer.from(eventTimestamp + plainToken), privateKeyFromSecret(secret)).toString("hex");
}

export function verifyQQWebhookSignature(secret: string, timestamp: string, rawBody: string, signatureHex: string) {
  if (!/^[a-fA-F0-9]{128}$/.test(signatureHex) || !/^\d{1,20}$/.test(timestamp)) return false;
  const publicKey = createPublicKey(privateKeyFromSecret(secret));
  return verify(null, Buffer.from(timestamp + rawBody), publicKey, Buffer.from(signatureHex, "hex"));
}

export async function handleQQWebhook(botId: string, callbackToken: string, appId: string, rawBody: string, headers: Headers) {
  const bot = getBotRowInternal(botId);
  if (bot.connection_mode !== "webhook") throw new Error("QQ_WEBHOOK_MODE_REQUIRED");
  if (!qqWebhookTokenMatches(deriveQQWebhookToken(bot.id, bot.client_secret_cipher), callbackToken)) throw new Error("QQ_WEBHOOK_TOKEN_INVALID");
  if (bot.app_id !== appId) throw new Error("QQ_WEBHOOK_APP_ID_MISMATCH");
  const secret = decryptSecret(bot.client_secret_cipher);
  let payload: QQEventEnvelope & { d?: { plain_token?: string; event_ts?: string } };
  try { payload = JSON.parse(rawBody) as typeof payload; }
  catch { throw new Error("QQ_WEBHOOK_BODY_INVALID"); }

  if (payload.op === 13) {
    const plainToken = payload.d?.plain_token;
    const eventTimestamp = payload.d?.event_ts;
    if (!plainToken || !eventTimestamp) throw new Error("QQ_WEBHOOK_CHALLENGE_INVALID");
    markBotWebhookActive(botId);
    return {
      challenge: {
        plain_token: plainToken,
        signature: signQQWebhookChallenge(secret, eventTimestamp, plainToken),
      },
    };
  }

  const signature = headers.get("x-signature-ed25519") || "";
  const timestamp = headers.get("x-signature-timestamp") || "";
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() - timestampSeconds * 1000) > 10 * 60_000) throw new Error("QQ_WEBHOOK_SIGNATURE_INVALID");
  if (!verifyQQWebhookSignature(secret, timestamp, rawBody, signature)) throw new Error("QQ_WEBHOOK_SIGNATURE_INVALID");
  const event = await ingestQQEvent(botId, "qq_webhook", payload, rawBody);
  markBotWebhookActive(botId);
  return { event };
}
