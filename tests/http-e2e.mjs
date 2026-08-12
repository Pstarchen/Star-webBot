import assert from "node:assert/strict";
import { createCipheriv, createHash, createPrivateKey, randomBytes, randomUUID, sign } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { StarBotClient } from "../sdk/node/index.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "starbot-http-e2e-"));
const databasePath = path.join(temporaryDirectory, "starbot-e2e.db");
const adminEmail = `admin-${randomUUID()}@starbot.local`;
const adminPassword = randomBytes(24).toString("base64url");
const userEmail = `user-${randomUUID()}@starbot.local`;
const userPassword = randomBytes(24).toString("base64url");
const encryptionKey = randomBytes(32).toString("base64");
const port = await availablePort();
const baseUrl = `http://localhost:${port}`;
const logs = [];

const server = spawn(process.execPath, [path.join(projectRoot, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)], {
  cwd: projectRoot,
  env: {
    ...process.env,
    DATABASE_PATH: databasePath,
    BOOTSTRAP_ADMIN_NAME: "E2E Administrator",
    BOOTSTRAP_ADMIN_EMAIL: adminEmail,
    BOOTSTRAP_ADMIN_PASSWORD: adminPassword,
    CREDENTIAL_ENCRYPTION_KEY: encryptionKey,
    ALLOW_PRIVATE_WEBHOOKS: "false",
    ALLOW_INSECURE_WEBHOOKS: "false",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

server.stdout.on("data", (chunk) => appendLog(chunk));
server.stderr.on("data", (chunk) => appendLog(chunk));

try {
  await waitForServer();
  const results = await runAssertions();
  console.log(JSON.stringify({ assertions: results.length, results }, null, 2));
} catch (error) {
  console.error(logs.join("").slice(-20_000));
  throw error;
} finally {
  await stopServer();
  const resolvedTemporaryDirectory = path.resolve(temporaryDirectory);
  const resolvedSystemTemporaryDirectory = path.resolve(os.tmpdir()) + path.sep;
  if (resolvedTemporaryDirectory.startsWith(resolvedSystemTemporaryDirectory) && path.basename(resolvedTemporaryDirectory).startsWith("starbot-http-e2e-")) {
    try {
      fs.rmSync(resolvedTemporaryDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (error) {
      console.warn(`Unable to remove E2E directory: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
}

function appendLog(chunk) {
  logs.push(chunk.toString());
  if (logs.length > 200) logs.shift();
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.unref();
    listener.on("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      const selectedPort = typeof address === "object" && address ? address.port : 0;
      listener.close((error) => error ? reject(error) : resolve(selectedPort));
    });
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`E2E server exited with code ${server.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/login`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("E2E server did not become ready");
}

async function stopServer() {
  if (server.exitCode !== null || !server.pid) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    server.kill("SIGTERM");
  }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
}

async function jsonResponse(requestPath, init = {}) {
  const response = await fetch(baseUrl + requestPath, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body };
}

function sessionCookie(response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie")];
  const value = values.find(Boolean);
  assert.ok(value, "Expected a session cookie");
  return value.split(";", 1)[0];
}

function encryptSecret(value) {
  const key = Buffer.from(encryptionKey, "base64");
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, initializationVector);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", initializationVector.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function qqWebhookSignature(secret, timestamp, rawBody) {
  let seed = secret;
  while (Buffer.byteLength(seed) < 32) seed += seed;
  const key = createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(seed).subarray(0, 32)]),
    format: "der",
    type: "pkcs8",
  });
  return sign(null, Buffer.from(timestamp + rawBody), key).toString("hex");
}

async function runAssertions() {
  const results = [];
  const originHeaders = { Origin: baseUrl, "Content-Type": "application/json" };
  const crossOriginHeaders = { Origin: "https://attacker.example", "Content-Type": "application/json" };

  const anonymousMedia = await fetch(`${baseUrl}/api/bots/missing/media`, { method: "POST" });
  assert.equal(anonymousMedia.status, 401);
  results.push("anonymous media upload is rejected");

  const anonymousMultipart = await fetch(`${baseUrl}/api/bots/missing/multipart?path=%2Fv2%2Fusers%2Fdemo%2Ffiles`, { method: "POST" });
  assert.equal(anonymousMultipart.status, 401);
  results.push("anonymous bot multipart is rejected");

  const registered = await jsonResponse("/api/auth/register", {
    method: "POST",
    headers: originHeaders,
    body: JSON.stringify({ name: "E2E Developer", email: userEmail, password: userPassword }),
  });
  assert.equal(registered.response.status, 201);
  assert.equal(registered.body.user.membershipPlan, "free");
  assert.equal(registered.body.user.botQuota, 1);
  const userId = registered.body.user.id;
  let userCookie = sessionCookie(registered.response);
  results.push("email registration creates a free membership session");

  const duplicateRegistration = await jsonResponse("/api/auth/register", {
    method: "POST",
    headers: originHeaders,
    body: JSON.stringify({ name: "Duplicate Developer", email: userEmail, password: userPassword }),
  });
  assert.equal(duplicateRegistration.response.status, 409);
  const wrongPassword = await jsonResponse("/api/auth/login", {
    method: "POST",
    headers: originHeaders,
    body: JSON.stringify({ email: userEmail, password: "definitely-wrong-password" }),
  });
  assert.equal(wrongPassword.response.status, 401);
  results.push("duplicate registration and invalid credentials are rejected");

  for (const [requestPath, init] of [
    ["/api/auth/register", { method: "POST", headers: crossOriginHeaders, body: JSON.stringify({ name: "Cross Origin", email: `csrf-${randomUUID()}@starbot.local`, password: userPassword }) }],
    ["/api/auth/login", { method: "POST", headers: crossOriginHeaders, body: JSON.stringify({ email: userEmail, password: userPassword }) }],
    ["/api/auth/logout", { method: "POST", headers: { Origin: "https://attacker.example", Cookie: userCookie } }],
  ]) {
    assert.equal((await fetch(baseUrl + requestPath, init)).status, 403);
  }
  assert.equal((await fetch(`${baseUrl}/api/bots`, { headers: { Cookie: userCookie } })).status, 200);
  results.push("cross-origin registration, login, and logout are rejected without ending the session");

  const adminLogin = await jsonResponse("/api/auth/login", {
    method: "POST",
    headers: originHeaders,
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  assert.equal(adminLogin.response.status, 200);
  assert.equal(adminLogin.body.user.role, "admin");
  const adminId = adminLogin.body.user.id;
  const adminCookie = sessionCookie(adminLogin.response);
  results.push("administrator login succeeds");

  for (const [requestPath, body] of [
    [`/api/users/${userId}/membership`, { planId: "pro" }],
    [`/api/users/${userId}/quota`, { botQuota: 7 }],
    [`/api/users/${adminId}/access`, { role: "developer", status: "active" }],
  ]) {
    const denied = await jsonResponse(requestPath, {
      method: "PATCH",
      headers: { ...originHeaders, Cookie: userCookie },
      body: JSON.stringify(body),
    });
    assert.equal(denied.response.status, 403);
  }
  const crossOriginMutation = await jsonResponse(`/api/users/${userId}/quota`, {
    method: "PATCH",
    headers: { ...crossOriginHeaders, Cookie: adminCookie },
    body: JSON.stringify({ botQuota: 7 }),
  });
  assert.equal(crossOriginMutation.response.status, 403);
  results.push("regular users and cross-origin requests cannot mutate administrative settings");

  for (const input of [
    { role: "developer", status: "active" },
    { role: "admin", status: "suspended" },
  ]) {
    const protectedAdmin = await jsonResponse(`/api/users/${adminId}/access`, {
      method: "PATCH",
      headers: { ...originHeaders, Cookie: adminCookie },
      body: JSON.stringify(input),
    });
    assert.equal(protectedAdmin.response.status, 409);
  }
  results.push("the current administrator cannot demote or suspend itself");

  const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { Origin: baseUrl, Cookie: userCookie } });
  assert.equal(logout.status, 200);
  assert.equal((await fetch(`${baseUrl}/api/bots`, { headers: { Cookie: userCookie } })).status, 401);
  const loginAfterLogout = await jsonResponse("/api/auth/login", {
    method: "POST",
    headers: originHeaders,
    body: JSON.stringify({ email: userEmail, password: userPassword }),
  });
  assert.equal(loginAfterLogout.response.status, 200);
  userCookie = sessionCookie(loginAfterLogout.response);
  results.push("logout invalidates the current server-side session");

  const membership = await jsonResponse(`/api/users/${userId}/membership`, {
    method: "PATCH",
    headers: { ...originHeaders, Cookie: adminCookie },
    body: JSON.stringify({ planId: "pro" }),
  });
  assert.equal(membership.response.status, 200);
  assert.equal(membership.body.plan.id, "pro");
  const quota = await jsonResponse(`/api/users/${userId}/quota`, {
    method: "PATCH",
    headers: { ...originHeaders, Cookie: adminCookie },
    body: JSON.stringify({ botQuota: 7 }),
  });
  assert.equal(quota.response.status, 200);
  const team = await jsonResponse("/api/users", { headers: { Cookie: adminCookie } });
  const managedUser = team.body.users.find((item) => item.id === userId);
  assert.equal(managedUser.botQuota, 7);
  assert.equal(managedUser.membershipPlan, "pro");
  results.push("administrator updates membership and bot quota");

  const database = new Database(databasePath);
  const now = new Date().toISOString();
  const botId = randomUUID();
  const appId = "e2e-qq-app-id";
  const clientSecret = "DG5g3B4j9X2KOErG";
  const encryptedSecret = encryptSecret(clientSecret);
  database.prepare(`
    INSERT INTO bots (id, user_id, name, app_id, client_secret_cipher, environment, connection_mode, intents, status, auto_connect, created_at, updated_at)
    VALUES (?, ?, 'E2E QQ Bot', ?, ?, 'sandbox', 'webhook', 33554432, 'offline', 0, ?, ?)
  `).run(botId, userId, appId, encryptedSecret, now, now);
  database.close();
  const callbackToken = createHash("sha256").update(botId).update("\0").update(encryptedSecret).digest("base64url");

  const quotaBelowUsage = await jsonResponse(`/api/users/${userId}/quota`, {
    method: "PATCH",
    headers: { ...originHeaders, Cookie: adminCookie },
    body: JSON.stringify({ botQuota: 0 }),
  });
  assert.equal(quotaBelowUsage.response.status, 409);
  results.push("robot quota cannot be reduced below current usage");

  const bots = await jsonResponse("/api/bots", { headers: { Cookie: userCookie } });
  const bot = bots.body.bots.find((item) => item.id === botId);
  assert.equal(bot.shardCount, 0);
  assert.equal(bot.onlineShards, 0);
  assert.equal(bot.connectionMode, "webhook");
  assert.equal(bot.webhookPath, `/api/qq-webhook/${botId}/${callbackToken}`);
  const serializedBot = JSON.stringify(bot);
  assert.equal(serializedBot.includes(clientSecret), false);
  assert.equal(serializedBot.includes(encryptedSecret), false);
  results.push("bot API returns shard and protected webhook fields");

  const sdkAppCreated = await jsonResponse("/api/plugins", {
    method: "POST",
    headers: { ...originHeaders, Cookie: userCookie },
    body: JSON.stringify({
      botId,
      name: "E2E SDK App",
      slug: `e2e-sdk-${randomUUID()}`,
      version: "1.0.0",
      events: ["*"],
      permissions: ["event:receive", "qq:api"],
    }),
  });
  assert.equal(sdkAppCreated.response.status, 201);
  assert.equal(sdkAppCreated.body.plugin.runtime, "sdk");
  assert.equal(sdkAppCreated.body.plugin.pendingEvents, 0);
  assert.ok(sdkAppCreated.body.signingSecret.length >= 32);
  const pluginId = sdkAppCreated.body.plugin.id;
  const pluginSecret = sdkAppCreated.body.signingSecret;
  const listedSdkApps = await jsonResponse("/api/plugins", { headers: { Cookie: userCookie } });
  assert.equal(JSON.stringify(listedSdkApps.body).includes(pluginSecret), false);
  results.push("SDK app creation returns its signing secret only once");

  const disabledSdkApp = await jsonResponse(`/api/plugins/${pluginId}`, {
    method: "PATCH",
    headers: { ...originHeaders, Cookie: userCookie },
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(disabledSdkApp.response.status, 200);
  const enabledSdkApp = await jsonResponse(`/api/plugins/${pluginId}`, {
    method: "PATCH",
    headers: { ...originHeaders, Cookie: userCookie },
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(enabledSdkApp.response.status, 200);
  results.push("SDK apps can be disabled and re-enabled");

  const webhookGateway = await fetch(`${baseUrl}/api/bots/${botId}/connect`, { method: "POST", headers: { Origin: baseUrl, Cookie: userCookie } });
  assert.equal(webhookGateway.status, 409);
  results.push("webhook mode does not start a WebSocket gateway");

  const multipartBody = Buffer.from("--e2e-boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"demo.txt\"\r\n\r\ndemo\r\n--e2e-boundary--\r\n");
  const unsignedPlugin = await fetch(`${baseUrl}/api/plugin-runtime/${pluginId}/multipart?path=%2Fv2%2Fusers%2Fdemo%2Ffiles`, {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=e2e-boundary" },
    body: multipartBody,
  });
  assert.equal(unsignedPlugin.status, 401);
  results.push("unsigned plugin multipart is rejected");

  const challengeBody = JSON.stringify({ op: 13, d: { plain_token: "Arq0D5A61EgUu4OxUvOp", event_ts: "1725442341" } });
  const invalidWebhook = await fetch(`${baseUrl}/api/qq-webhook/${botId}/invalid-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Bot-Appid": appId },
    body: challengeBody,
  });
  assert.equal(invalidWebhook.status, 403);
  const validWebhook = await jsonResponse(`/api/qq-webhook/${botId}/${callbackToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Bot-Appid": appId },
    body: challengeBody,
  });
  assert.equal(validWebhook.response.status, 200);
  assert.deepEqual(validWebhook.body, {
    plain_token: "Arq0D5A61EgUu4OxUvOp",
    signature: "87befc99c42c651b3aac0278e71ada338433ae26fcb24307bdc5ad38c1adc2d01bcfcadc0842edac85e85205028a1132afe09280305f13aa6909ffc2d652c706",
  });
  results.push("QQ webhook challenge matches the official signature sample");

  const eventBody = JSON.stringify({ op: 0, t: "C2C_MESSAGE_CREATE", id: `event-${randomUUID()}`, d: { id: `message-${randomUUID()}`, content: "hello sdk", author: { user_openid: "openid-e2e" } } });
  const eventTimestamp = Math.floor(Date.now() / 1000).toString();
  const qqEvent = await jsonResponse(`/api/qq-webhook/${botId}/${callbackToken}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bot-Appid": appId,
      "X-Signature-Timestamp": eventTimestamp,
      "X-Signature-Ed25519": qqWebhookSignature(clientSecret, eventTimestamp, eventBody),
    },
    body: eventBody,
  });
  assert.equal(qqEvent.response.status, 200);

  const sdk = new StarBotClient({ platformUrl: baseUrl, pluginId, secret: pluginSecret });
  const pulled = await sdk.pullEvents({ limit: 10, waitMs: 0 });
  assert.equal(pulled.events.length, 1);
  assert.equal(pulled.events[0].type, "C2C_MESSAGE_CREATE");
  assert.equal(pulled.events[0].data.content, "hello sdk");
  const acknowledged = await sdk.ackEvents(pulled.leaseToken, [pulled.events[0].id]);
  assert.equal(acknowledged.acknowledged, 1);
  results.push("signed QQ webhook events flow through SDK pull and atomic acknowledgment");

  const rotated = await jsonResponse(`/api/plugins/${pluginId}`, {
    method: "POST",
    headers: { Origin: baseUrl, Cookie: userCookie },
  });
  assert.equal(rotated.response.status, 200);
  assert.ok(rotated.body.signingSecret.length >= 32);
  await assert.rejects(() => sdk.pullEvents({ waitMs: 0 }), (error) => error?.status === 401);
  const rotatedSdk = new StarBotClient({ platformUrl: baseUrl, pluginId, secret: rotated.body.signingSecret });
  assert.deepEqual((await rotatedSdk.pullEvents({ waitMs: 0 })).events, []);
  results.push("SDK secret rotation invalidates the previous secret immediately");

  const deletedSdkApp = await jsonResponse(`/api/plugins/${pluginId}`, {
    method: "DELETE",
    headers: { Origin: baseUrl, Cookie: userCookie },
  });
  assert.equal(deletedSdkApp.response.status, 200);
  await assert.rejects(() => rotatedSdk.pullEvents({ waitMs: 0 }), (error) => error?.status === 401);
  const sdkAppsAfterDelete = await jsonResponse("/api/plugins", { headers: { Cookie: userCookie } });
  assert.equal(sdkAppsAfterDelete.body.plugins.some((item) => item.id === pluginId), false);
  results.push("SDK app deletion revokes access and releases the app slot");

  const suspend = await jsonResponse(`/api/users/${userId}/access`, {
    method: "PATCH",
    headers: { ...originHeaders, Cookie: adminCookie },
    body: JSON.stringify({ role: "developer", status: "suspended" }),
  });
  assert.equal(suspend.response.status, 200);
  const suspendedSession = await fetch(`${baseUrl}/api/bots`, { headers: { Cookie: userCookie } });
  assert.equal(suspendedSession.status, 401);
  const reactivate = await jsonResponse(`/api/users/${userId}/access`, {
    method: "PATCH",
    headers: { ...originHeaders, Cookie: adminCookie },
    body: JSON.stringify({ role: "developer", status: "active" }),
  });
  assert.equal(reactivate.response.status, 200);
  const userLogin = await jsonResponse("/api/auth/login", {
    method: "POST",
    headers: originHeaders,
    body: JSON.stringify({ email: userEmail, password: userPassword }),
  });
  assert.equal(userLogin.response.status, 200);
  assert.equal(userLogin.body.user.botQuota, 7);
  assert.equal(userLogin.body.user.membershipPlan, "pro");
  userCookie = sessionCookie(userLogin.response);
  assert.ok(userCookie.startsWith("starbot_session="));
  results.push("suspension invalidates sessions and reactivation works");

  return results;
}
