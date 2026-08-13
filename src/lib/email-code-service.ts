import "server-only";
import net from "node:net";
import tls from "node:tls";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { getDatabase, writeAuditLog } from "@/lib/database";
import type { SessionUser } from "@/types/platform";

export type EmailCodePurpose = "login" | "register";

const CODE_TTL_MS = 10 * 60 * 1000;
const SEND_COOLDOWN_MS = 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

type EmailOutboxEntry = {
  to: string;
  purpose: EmailCodePurpose;
  code: string;
  subject: string;
  createdAt: string;
};

type GlobalEmailOutbox = typeof globalThis & {
  __starbotEmailOutbox?: EmailOutboxEntry[];
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashCode(email: string, purpose: EmailCodePurpose, code: string) {
  const pepper = process.env.EMAIL_CODE_PEPPER || process.env.CREDENTIAL_ENCRYPTION_KEY || "starbot-email-code";
  return createHash("sha256").update([normalizeEmail(email), purpose, code, pepper].join(":")).digest("hex");
}

function verificationCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function smtpPort() {
  return Number(process.env.SMTP_PORT || (process.env.SMTP_SECURE === "true" ? 465 : 587));
}

function smtpSecure() {
  return process.env.SMTP_SECURE === "true" || smtpPort() === 465;
}

function mailFrom() {
  return process.env.SMTP_FROM || "";
}

function encodeSubject(value: string) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function sanitizeHeader(value: string) {
  return value.replace(/[\r\n]/g, " ").trim();
}

function smtpData(subject: string, to: string, text: string) {
  const from = sanitizeHeader(mailFrom());
  return [
    `From: ${from}`,
    `To: ${sanitizeHeader(to)}`,
    `Subject: ${encodeSubject(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
  ].join("\r\n");
}

function writeLine(socket: net.Socket | tls.TLSSocket, line: string) {
  socket.write(`${line}\r\n`);
}

function waitForResponse(socket: net.Socket | tls.TLSSocket, expected: number[]) {
  return new Promise<string>((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("EMAIL_SMTP_TIMEOUT"));
    }, 10_000);

    function cleanup() {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
    }

    function onError(error: Error) {
      cleanup();
      reject(error);
    }

    function onData(chunk: Buffer) {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines.at(-1);
      if (!last || !/^\d{3} /.test(last)) return;
      const code = Number(last.slice(0, 3));
      cleanup();
      if (expected.includes(code)) resolve(buffer);
      else reject(new Error(`EMAIL_SMTP_REJECTED:${code}`));
    }

    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function connectSmtp() {
  const host = process.env.SMTP_HOST;
  if (!host || !mailFrom()) throw new Error("EMAIL_SMTP_NOT_CONFIGURED");
  const port = smtpPort();
  const secure = smtpSecure();
  const socket = secure
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port });
  await new Promise<void>((resolve, reject) => {
    socket.once(secure ? "secureConnect" : "connect", resolve);
    socket.once("error", reject);
  });
  await waitForResponse(socket, [220]);
  return socket;
}

async function sendSmtpMail(to: string, subject: string, text: string) {
  const socket = await connectSmtp();
  const hostName = process.env.SMTP_HELO || "localhost";
  try {
    writeLine(socket, `EHLO ${hostName}`);
    await waitForResponse(socket, [250]);

    if (!smtpSecure() && process.env.SMTP_STARTTLS !== "false") {
      writeLine(socket, "STARTTLS");
      await waitForResponse(socket, [220]);
      const secureSocket = tls.connect({ socket, servername: process.env.SMTP_HOST });
      await new Promise<void>((resolve, reject) => {
        secureSocket.once("secureConnect", resolve);
        secureSocket.once("error", reject);
      });
      writeLine(secureSocket, `EHLO ${hostName}`);
      await waitForResponse(secureSocket, [250]);
      await finishSmtpMail(secureSocket, to, subject, text);
      return;
    }

    await finishSmtpMail(socket, to, subject, text);
  } finally {
    socket.end();
  }
}

async function finishSmtpMail(socket: net.Socket | tls.TLSSocket, to: string, subject: string, text: string) {
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    writeLine(socket, "AUTH LOGIN");
    await waitForResponse(socket, [334]);
    writeLine(socket, Buffer.from(process.env.SMTP_USER).toString("base64"));
    await waitForResponse(socket, [334]);
    writeLine(socket, Buffer.from(process.env.SMTP_PASS).toString("base64"));
    await waitForResponse(socket, [235]);
  }
  writeLine(socket, `MAIL FROM:<${mailFrom()}>`);
  await waitForResponse(socket, [250]);
  writeLine(socket, `RCPT TO:<${to}>`);
  await waitForResponse(socket, [250, 251]);
  writeLine(socket, "DATA");
  await waitForResponse(socket, [354]);
  socket.write(`${smtpData(subject, to, text).replace(/\r?\n\./g, "\r\n..")}\r\n.\r\n`);
  await waitForResponse(socket, [250]);
  writeLine(socket, "QUIT");
}

async function deliverCode(email: string, purpose: EmailCodePurpose, code: string) {
  const subject = purpose === "login" ? "StarBot 登录验证码" : "StarBot 注册验证码";
  const text = [
    `你的验证码是：${code}`,
    "",
    "验证码 10 分钟内有效，请勿转发给他人。",
    purpose === "login" ? "如果不是你本人正在登录，请忽略这封邮件。" : "如果不是你本人正在注册，请忽略这封邮件。",
  ].join("\n");

  if (process.env.EMAIL_CODE_TRANSPORT === "memory" || process.env.NODE_ENV === "test") {
    const state = globalThis as GlobalEmailOutbox;
    state.__starbotEmailOutbox ||= [];
    state.__starbotEmailOutbox.push({ to: email, purpose, code, subject, createdAt: new Date().toISOString() });
    return;
  }

  if (!smtpConfigured()) throw new Error("EMAIL_SMTP_NOT_CONFIGURED");
  await sendSmtpMail(email, subject, text);
}

export function latestEmailCodeForTest(email: string, purpose: EmailCodePurpose) {
  if (process.env.NODE_ENV !== "test") return null;
  const state = globalThis as GlobalEmailOutbox;
  return [...(state.__starbotEmailOutbox || [])].reverse().find((entry) => entry.to === normalizeEmail(email) && entry.purpose === purpose) || null;
}

export async function sendEmailVerificationCode(input: { email: string; purpose: EmailCodePurpose }) {
  const database = getDatabase();
  const email = normalizeEmail(input.email);
  const nowMs = Date.now();
  const recent = database.prepare(`
    SELECT sent_at FROM email_verification_codes
    WHERE email = ? AND purpose = ? AND consumed_at IS NULL
    ORDER BY sent_at DESC LIMIT 1
  `).get(email, input.purpose) as { sent_at: string } | undefined;
  if (recent && nowMs - new Date(recent.sent_at).getTime() < SEND_COOLDOWN_MS) throw new Error("EMAIL_CODE_COOLDOWN");

  const userExists = Boolean(database.prepare("SELECT id FROM users WHERE email = ?").get(email));
  if (input.purpose === "login" && !userExists) throw new Error("EMAIL_LOGIN_USER_NOT_FOUND");
  if (input.purpose === "register" && userExists) throw new Error("EMAIL_REGISTER_USER_EXISTS");

  const code = verificationCode();
  const now = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + CODE_TTL_MS).toISOString();
  database.prepare(`
    INSERT INTO email_verification_codes (id, email, purpose, code_hash, attempts, expires_at, consumed_at, created_at, sent_at)
    VALUES (?, ?, ?, ?, 0, ?, NULL, ?, ?)
  `).run(randomUUID(), email, input.purpose, hashCode(email, input.purpose, code), expiresAt, now, now);

  await deliverCode(email, input.purpose, code);
  writeAuditLog(null, "auth.email_code.send", "user", null, { email, purpose: input.purpose });
  return { expiresInSeconds: Math.floor(CODE_TTL_MS / 1000), cooldownSeconds: Math.floor(SEND_COOLDOWN_MS / 1000) };
}

export function consumeEmailVerificationCode(input: { email: string; purpose: EmailCodePurpose; code: string }, actor?: SessionUser | null) {
  const database = getDatabase();
  const email = normalizeEmail(input.email);
  const now = new Date().toISOString();
  const row = database.prepare(`
    SELECT id, code_hash, attempts FROM email_verification_codes
    WHERE email = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ?
    ORDER BY created_at DESC LIMIT 1
  `).get(email, input.purpose, now) as { id: string; code_hash: string; attempts: number } | undefined;
  if (!row) throw new Error("EMAIL_CODE_INVALID");
  if (row.attempts >= MAX_VERIFY_ATTEMPTS) throw new Error("EMAIL_CODE_TOO_MANY_ATTEMPTS");

  const expected = hashCode(email, input.purpose, input.code.trim());
  if (expected !== row.code_hash) {
    database.prepare("UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ?").run(row.id);
    throw new Error("EMAIL_CODE_INVALID");
  }

  database.prepare("UPDATE email_verification_codes SET consumed_at = ? WHERE id = ?").run(now, row.id);
  writeAuditLog(actor?.id || null, "auth.email_code.consume", "user", actor?.id || null, { email, purpose: input.purpose });
}
