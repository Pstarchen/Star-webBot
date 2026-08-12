import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

export function deriveQQWebhookToken(botId: string, encryptedSecret: string) {
  return createHash("sha256").update(botId).update("\0").update(encryptedSecret).digest("base64url");
}

export function qqWebhookTokenMatches(expected: string, received: string) {
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}
