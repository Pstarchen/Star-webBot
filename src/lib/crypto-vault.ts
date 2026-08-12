import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function encryptionKey() {
  const configured = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (configured) {
    const key = Buffer.from(configured, "base64");
    if (key.length !== 32) throw new Error("CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes");
    return key;
  }
  if (process.env.NODE_ENV === "production") throw new Error("CREDENTIAL_ENCRYPTION_KEY is required in production");
  return createHash("sha256").update(process.env.AUTH_SECRET || "starbot-local-development-vault").digest();
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), authTag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(value: string) {
  const [version, ivValue, authTagValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !authTagValue || !encryptedValue) throw new Error("Unsupported encrypted secret format");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}
