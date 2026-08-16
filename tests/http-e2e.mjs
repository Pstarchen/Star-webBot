import assert from "node:assert/strict";
import { createCipheriv, createHash, createPrivateKey, randomBytes, randomUUID, sign } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { strToU8, zipSync } from "fflate";
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
const smtpPort = await availablePort();
const baseUrl = `http://localhost:${port}`;
const logs = [];
const receivedEmails = [];
const smtpServer = net.createServer((socket) => {
  let dataMode = false;
  let message = "";
  socket.setEncoding("utf8");
  socket.write("220 starbot-test-smtp\r\n");
  socket.on("data", (chunk) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (!line && !dataMode) continue;
      if (dataMode) {
        if (line === ".") {
          receivedEmails.push(message);
          message = "";
          dataMode = false;
          socket.write("250 queued\r\n");
        } else {
          message += `${line}\n`;
        }
        continue;
      }
      const command = line.toUpperCase();
      if (command.startsWith("EHLO") || command.startsWith("HELO")) socket.write("250 starbot-test-smtp\r\n");
      else if (command.startsWith("MAIL FROM")) socket.write("250 ok\r\n");
      else if (command.startsWith("RCPT TO")) socket.write("250 ok\r\n");
      else if (command === "DATA") {
        dataMode = true;
        socket.write("354 end with dot\r\n");
      } else if (command === "QUIT") {
        socket.write("221 bye\r\n");
        socket.end();
      } else socket.write("250 ok\r\n");
    }
  });
});
await new Promise((resolve, reject) => smtpServer.listen(smtpPort, "127.0.0.1", resolve).once("error", reject));

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
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(smtpPort),
    SMTP_FROM: "StarBot <noreply@starbot.local>",
    SMTP_STARTTLS: "false",
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
  await new Promise((resolve) => smtpServer.close(resolve));
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

async function latestVerificationCode(email) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const message = [...receivedEmails].reverse().find((value) => value.includes(email));
    const match = message?.match(/验证码是：(\d{6})/);
    if (match) return match[1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Verification code email was not received for ${email}`);
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

  const anonymousMediaTargets = await fetch(`${baseUrl}/api/bots/missing/media-targets`);
  assert.equal(anonymousMediaTargets.status, 401);
  results.push("anonymous media target access is rejected");

  const anonymousMultipart = await fetch(`${baseUrl}/api/bots/missing/multipart?path=%2Fv2%2Fusers%2Fdemo%2Ffiles`, { method: "POST" });
  assert.equal(anonymousMultipart.status, 401);
  results.push("anonymous bot multipart is rejected");

  const anonymousPluginCenter = await fetch(`${baseUrl}/api/plugin-center`);
  assert.equal(anonymousPluginCenter.status, 401);
  results.push("anonymous plugin center access is rejected");

  const anonymousEmailTest = await fetch(`${baseUrl}/api/system-settings/email-test`, { method: "POST" });
  assert.equal(anonymousEmailTest.status, 401);

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

  const emailSettings = await jsonResponse("/api/system-settings", {
    method: "PATCH",
    headers: { ...originHeaders, Cookie: adminCookie },
    body: JSON.stringify({
      section: "email",
      registrationVerificationEnabled: true,
      loginEnabled: true,
      smtpHost: "127.0.0.1",
      smtpPort,
      smtpSecure: false,
      smtpStarttls: false,
      smtpFrom: "noreply@starbot.local",
      smtpUser: "",
      smtpPass: "e2e-smtp-password",
    }),
  });
  assert.equal(emailSettings.response.status, 200);
  assert.equal(emailSettings.body.settings.email.smtpPassConfigured, true);
  assert.equal(JSON.stringify(emailSettings.body).includes("e2e-smtp-password"), false);
  results.push("administrator enables email verification without exposing SMTP secrets");

  const emailConfigurationTest = await jsonResponse("/api/system-settings/email-test", {
    method: "POST",
    headers: { ...originHeaders, Cookie: adminCookie },
    body: JSON.stringify({ email: adminEmail }),
  });
  assert.equal(emailConfigurationTest.response.status, 200);
  assert.equal(emailConfigurationTest.body.recipient, adminEmail);
  assert.ok(receivedEmails.some((message) => message.includes(adminEmail) && message.includes("邮箱配置测试邮件")));
  results.push("administrator can send an SMTP configuration test email");

  const registrationWithoutCode = await jsonResponse("/api/auth/register", {
    method: "POST",
    headers: originHeaders,
    body: JSON.stringify({ name: "Unverified User", email: userEmail, password: userPassword }),
  });
  assert.equal(registrationWithoutCode.response.status, 400);
  assert.match(registrationWithoutCode.body.message, /邮箱验证码/);
  results.push("enabled registration verification rejects requests without an email code");

  const registerCodeRequest = await jsonResponse("/api/auth/email-code", {
    method: "POST",
    headers: originHeaders,
    body: JSON.stringify({ email: userEmail, purpose: "register" }),
  });
  assert.equal(registerCodeRequest.response.status, 200);
  const registerCode = await latestVerificationCode(userEmail);
  const registered = await jsonResponse("/api/auth/register", {
    method: "POST",
    headers: originHeaders,
    body: JSON.stringify({ name: "E2E Developer", email: userEmail, password: userPassword, code: registerCode }),
  });
  assert.equal(registered.response.status, 201);
  assert.equal(registered.body.user.membershipPlan, "free");
  assert.equal(registered.body.user.botQuota, 1);
  assert.doesNotMatch(registered.response.headers.get("set-cookie") || "", /;\s*Secure/i);
  const userId = registered.body.user.id;
  let userCookie = sessionCookie(registered.response);
  results.push("HTTP registration creates a browser-compatible free membership session");

  const duplicateRegistration = await jsonResponse("/api/auth/email-code", {
    method: "POST",
    headers: originHeaders,
    body: JSON.stringify({ email: userEmail, purpose: "register" }),
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
    ["/api/auth/register", { method: "POST", headers: crossOriginHeaders, body: JSON.stringify({ name: "Cross Origin", email: `csrf-${randomUUID()}@starbot.local`, password: userPassword, code: "000000" }) }],
    ["/api/auth/login", { method: "POST", headers: crossOriginHeaders, body: JSON.stringify({ email: userEmail, password: userPassword }) }],
    ["/api/auth/logout", { method: "POST", headers: { Origin: "https://attacker.example", Cookie: userCookie } }],
  ]) {
    assert.equal((await fetch(baseUrl + requestPath, init)).status, 403);
  }
  assert.equal((await fetch(`${baseUrl}/api/bots`, { headers: { Cookie: userCookie } })).status, 200);
  results.push("cross-origin registration, login, and logout are rejected without ending the session");

  const regularSettings = await jsonResponse("/api/system-settings", { headers: { Cookie: userCookie } });
  assert.equal(regularSettings.response.status, 403);
  const regularEmailTest = await jsonResponse("/api/system-settings/email-test", {
    method: "POST",
    headers: { ...originHeaders, Cookie: userCookie },
    body: JSON.stringify({ email: userEmail }),
  });
  assert.equal(regularEmailTest.response.status, 403);
  const crossOriginEmailTest = await jsonResponse("/api/system-settings/email-test", {
    method: "POST",
    headers: { Origin: "https://attacker.example", "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ email: adminEmail }),
  });
  assert.equal(crossOriginEmailTest.response.status, 403);
  const regularOrders = await jsonResponse("/api/membership/orders", { headers: { Cookie: userCookie } });
  assert.equal(regularOrders.response.status, 403);
  const deniedSiteUpdate = await jsonResponse("/api/system-settings", {
    method: "PATCH",
    headers: { ...originHeaders, Cookie: userCookie },
    body: JSON.stringify({
      section: "site",
      siteName: "Unauthorized Site",
      siteTagline: "Unauthorized",
      siteDescription: "This update must never be accepted by the server.",
      icpCode: "",
      icpUrl: "",
      policeCode: "",
      policeUrl: "",
      copyrightText: "",
    }),
  });
  assert.equal(deniedSiteUpdate.response.status, 403);
  results.push("regular users and cross-origin requests cannot test administrative email settings");

  const siteUpdate = await jsonResponse("/api/system-settings", {
    method: "PATCH",
    headers: { ...originHeaders, Cookie: adminCookie },
    body: JSON.stringify({
      section: "site",
      siteName: "StarBot E2E",
      siteTagline: "QQ Bot Operations",
      siteDescription: "用于端到端验证的多机器人管理与会员支付平台。",
      icpCode: "京ICP备12345678号",
      icpUrl: "https://beian.miit.gov.cn/",
      policeCode: "京公网安备110000000001号",
      policeUrl: "https://www.beian.gov.cn/",
      copyrightText: "StarBot E2E",
    }),
  });
  assert.equal(siteUpdate.response.status, 200);
  assert.equal(siteUpdate.body.settings.site.siteName, "StarBot E2E");
  const publicSettings = await jsonResponse("/api/public-settings");
  assert.equal(publicSettings.response.status, 200);
  assert.equal(publicSettings.body.settings.icpCode, "京ICP备12345678号");

  const logoBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const deniedLogo = await fetch(`${baseUrl}/api/system-settings/assets/logo`, {
    method: "PUT",
    headers: { Origin: baseUrl, Cookie: userCookie, "Content-Type": "image/png" },
    body: logoBytes,
  });
  assert.equal(deniedLogo.status, 403);
  const logoUpload = await jsonResponse("/api/system-settings/assets/logo", {
    method: "PUT",
    headers: { Origin: baseUrl, Cookie: adminCookie, "Content-Type": "image/png" },
    body: logoBytes,
  });
  assert.equal(logoUpload.response.status, 200);
  const publicLogo = await fetch(`${baseUrl}/api/site-assets/logo`);
  assert.equal(publicLogo.status, 200);
  assert.equal(publicLogo.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await publicLogo.arrayBuffer()), logoBytes);
  const faviconUpload = await jsonResponse("/api/system-settings/assets/favicon", {
    method: "PUT",
    headers: { Origin: baseUrl, Cookie: adminCookie, "Content-Type": "image/png" },
    body: logoBytes,
  });
  assert.equal(faviconUpload.response.status, 200);
  const publicFavicon = await fetch(`${baseUrl}/api/site-assets/favicon`);
  assert.equal(publicFavicon.status, 200);
  assert.equal(publicFavicon.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await publicFavicon.arrayBuffer()), logoBytes);
  const settingsWithAssets = await jsonResponse("/api/public-settings");
  assert.equal(settingsWithAssets.body.settings.logoUrl, "/api/site-assets/logo");
  assert.equal(settingsWithAssets.body.settings.faviconUrl, "/api/site-assets/favicon");
  results.push("administrator branding, filing information, logo, and favicon persist publicly");

  const qqSecret = "e2e-qq-login-secret";
  const qqSettings = await jsonResponse("/api/system-settings", {
    method: "PATCH",
    headers: { ...originHeaders, Cookie: adminCookie },
    body: JSON.stringify({
      section: "qq",
      enabled: false,
      appId: "e2e-qq-login-app",
      appSecret: qqSecret,
      redirectUri: `${baseUrl}/api/auth/qq/callback`,
    }),
  });
  assert.equal(qqSettings.response.status, 200);
  assert.equal(qqSettings.body.settings.qq.appSecretConfigured, true);
  assert.equal(JSON.stringify(qqSettings.body).includes(qqSecret), false);

  const paymentSettings = await jsonResponse("/api/system-settings", {
    method: "PATCH",
    headers: { ...originHeaders, Cookie: adminCookie },
    body: JSON.stringify({
      section: "payment",
      enabled: true,
      provider: "sandbox",
      epayGatewayUrl: "",
      epayPid: "",
      manualInstructions: "",
    }),
  });
  assert.equal(paymentSettings.response.status, 400);

  const manualPaymentSettings = await jsonResponse("/api/system-settings", {
    method: "PATCH",
    headers: { ...originHeaders, Cookie: adminCookie },
    body: JSON.stringify({
      section: "payment",
      enabled: true,
      provider: "manual",
      epayGatewayUrl: "",
      epayPid: "",
      manualInstructions: "E2E 人工收款验证",
    }),
  });
  assert.equal(manualPaymentSettings.response.status, 200);
  assert.equal(manualPaymentSettings.body.settings.payment.provider, "manual");

  const planList = await jsonResponse("/api/membership-plans", { headers: { Cookie: adminCookie } });
  const proPlan = planList.body.plans.find((plan) => plan.id === "pro");
  const pricedPlan = await jsonResponse("/api/membership-plans", {
    method: "PATCH",
    headers: { ...originHeaders, Cookie: adminCookie },
    body: JSON.stringify({ ...proPlan, monthlyPriceCents: 3100 }),
  });
  assert.equal(pricedPlan.response.status, 200);
  assert.equal(pricedPlan.body.plan.monthlyPriceCents, 3100);

  const purchase = await jsonResponse("/api/membership/orders", {
    method: "POST",
    headers: { ...originHeaders, Cookie: userCookie },
    body: JSON.stringify({ planId: "pro", billingCycle: "monthly", paymentChannel: "alipay", amountCents: 1 }),
  });
  assert.equal(purchase.response.status, 201);
  assert.equal(purchase.body.order.status, "pending");
  assert.equal(purchase.body.order.amountCents, 3100);
  assert.equal(purchase.body.order.paymentChannel, "manual");
  const userConfirmation = await jsonResponse(`/api/membership/orders/${purchase.body.order.id}/confirm`, {
    method: "POST",
    headers: { ...originHeaders, Cookie: userCookie },
    body: JSON.stringify({ providerTradeNo: "forged-user-confirmation" }),
  });
  assert.equal(userConfirmation.response.status, 403);
  const adminConfirmation = await jsonResponse(`/api/membership/orders/${purchase.body.order.id}/confirm`, {
    method: "POST",
    headers: { ...originHeaders, Cookie: adminCookie },
    body: JSON.stringify({ providerTradeNo: "e2e-manual-trade", note: "E2E 管理员确认到账" }),
  });
  assert.equal(adminConfirmation.response.status, 200);
  assert.equal(adminConfirmation.body.order.status, "paid");
  assert.equal(adminConfirmation.body.membership.plan.id, "pro");
  assert.equal(adminConfirmation.body.membership.botQuota, 5);
  const membershipCenter = await jsonResponse("/api/membership", { headers: { Cookie: userCookie } });
  assert.equal(membershipCenter.response.status, 200);
  assert.equal(membershipCenter.body.current.plan.id, "pro");
  assert.ok(membershipCenter.body.current.expiresAt);
  assert.equal(membershipCenter.body.orders[0].amountCents, 3100);
  results.push("production rejects sandbox and administrator-confirmed orders use server pricing");

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
  const mediaTargetOpenid = "e2e-group-openid";
  database.prepare(`
    INSERT INTO event_logs (id, bot_id, event_type, scene, status, latency_ms, content, payload_json, trace_id, received_at)
    VALUES (?, ?, 'GROUP_AT_MESSAGE_CREATE', '群聊', 'success', 0, '', ?, NULL, ?)
  `).run(randomUUID(), botId, JSON.stringify({ d: { id: "e2e-group-message", group_openid: mediaTargetOpenid } }), now);
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

  const mediaTargets = await jsonResponse(`/api/bots/${botId}/media-targets`, { headers: { Cookie: userCookie } });
  assert.equal(mediaTargets.response.status, 200);
  assert.deepEqual(mediaTargets.body.targets, [{ targetType: "group", targetOpenid: mediaTargetOpenid, lastSeenAt: now }]);
  results.push("media targets come from the selected bot's received events");

  const unknownTargetUpload = new FormData();
  unknownTargetUpload.set("targetType", "group");
  unknownTargetUpload.set("targetOpenid", "unknown-group-openid");
  unknownTargetUpload.set("fileType", "1");
  unknownTargetUpload.set("srvSendMsg", "false");
  unknownTargetUpload.set("file", new File([logoBytes], "unknown.png", { type: "image/png" }));
  const unknownMedia = await jsonResponse(`/api/bots/${botId}/media`, {
    method: "POST",
    headers: { Origin: baseUrl, Cookie: userCookie },
    body: unknownTargetUpload,
  });
  assert.equal(unknownMedia.response.status, 400);
  assert.equal(unknownMedia.body.code, "MEDIA_TARGET_NOT_OBSERVED");
  results.push("media upload rejects unobserved OpenIDs before calling QQ");

  const initialPluginCenter = await jsonResponse("/api/plugin-center", { headers: { Cookie: userCookie } });
  assert.equal(initialPluginCenter.response.status, 200);
  assert.ok(initialPluginCenter.body.marketplace.some((item) => item.slug === "keyword-reply"));
  assert.deepEqual(initialPluginCenter.body.installations, []);
  results.push("plugin center exposes persisted marketplace listings");

  const hostedManifest = {
    schemaVersion: 1,
    id: `e2e-counter-${randomUUID()}`,
    name: "E2E 托管计数器",
    version: "1.0.0",
    description: "验证插件导入、配置、事件执行和市场审核的端到端流程。",
    author: "E2E Developer",
    category: "自动化",
    tags: ["E2E"],
    entry: "index.js",
    events: ["C2C_MESSAGE_CREATE"],
    permissions: ["storage:kv", "log:write"],
    commands: [{ name: "计数", description: "记录收到的单聊事件" }],
    configSchema: [{ key: "step", label: "步长", type: "number", required: true, default: 1, min: 1, max: 10 }],
  };
  const hostedPackage = zipSync({
    "starbot.plugin.json": strToU8(JSON.stringify(hostedManifest)),
    "index.js": strToU8(`StarBot.definePlugin({ onEvent(event, sdk) {
      sdk.kv.set("seen", sdk.kv.get("seen", 0) + sdk.config.step);
      sdk.log.info("handled", event.type);
    }});`),
  });
  const crossOriginImport = await jsonResponse("/api/plugin-projects/import", {
    method: "POST",
    headers: { Origin: "https://attacker.example", "Content-Type": "application/zip", Cookie: userCookie },
    body: hostedPackage,
  });
  assert.equal(crossOriginImport.response.status, 403);
  const importedPlugin = await jsonResponse("/api/plugin-projects/import", {
    method: "POST",
    headers: { Origin: baseUrl, "Content-Type": "application/zip", Cookie: userCookie },
    body: hostedPackage,
  });
  assert.equal(importedPlugin.response.status, 201);
  assert.equal(importedPlugin.body.manifest.id, hostedManifest.id);
  const hostedProjectId = importedPlugin.body.projectId;
  const hostedVersionId = importedPlugin.body.versionId;
  results.push("trusted ZIP import creates an isolated private plugin version");

  const installedPlugin = await jsonResponse("/api/plugin-installations", {
    method: "POST",
    headers: { ...originHeaders, Cookie: userCookie },
    body: JSON.stringify({ projectId: hostedProjectId, versionId: hostedVersionId, botId, priority: 15 }),
  });
  assert.equal(installedPlugin.response.status, 201);
  const installationId = installedPlugin.body.installationId;
  const duplicateInstall = await jsonResponse("/api/plugin-installations", {
    method: "POST",
    headers: { ...originHeaders, Cookie: userCookie },
    body: JSON.stringify({ projectId: hostedProjectId, versionId: hostedVersionId, botId, priority: 15 }),
  });
  assert.equal(duplicateInstall.response.status, 409);
  const configuredPlugin = await jsonResponse(`/api/plugin-installations/${installationId}`, {
    method: "PATCH",
    headers: { ...originHeaders, Cookie: userCookie },
    body: JSON.stringify({ enabled: true, priority: 12, config: { step: 4 } }),
  });
  assert.equal(configuredPlugin.response.status, 200);
  results.push("plugins install once per bot and validate per-installation configuration");

  const reviewRequested = await jsonResponse(`/api/plugin-projects/${hostedProjectId}/review`, {
    method: "POST",
    headers: { ...originHeaders, Cookie: userCookie },
    body: JSON.stringify({ versionId: hostedVersionId }),
  });
  assert.equal(reviewRequested.response.status, 201);
  const reviewId = reviewRequested.body.reviewId;
  const userReviewDenied = await jsonResponse(`/api/plugin-reviews/${reviewId}`, {
    method: "PATCH",
    headers: { ...originHeaders, Cookie: userCookie },
    body: JSON.stringify({ approved: true }),
  });
  assert.equal(userReviewDenied.response.status, 403);
  const approvedReview = await jsonResponse(`/api/plugin-reviews/${reviewId}`, {
    method: "PATCH",
    headers: { ...originHeaders, Cookie: adminCookie },
    body: JSON.stringify({ approved: true, featured: true }),
  });
  assert.equal(approvedReview.response.status, 200);
  const publishedCenter = await jsonResponse("/api/plugin-center", { headers: { Cookie: userCookie } });
  assert.ok(publishedCenter.body.marketplace.some((item) => item.id === hostedProjectId && item.featured));
  results.push("only administrators can approve plugin marketplace publication");

  const userMarketplaceEditDenied = await jsonResponse(`/api/plugin-marketplace/${hostedProjectId}`, {
    method: "PATCH",
    headers: { ...originHeaders, Cookie: userCookie },
    body: JSON.stringify({ name: "Unauthorized marketplace edit" }),
  });
  assert.equal(userMarketplaceEditDenied.response.status, 403);
  const crossOriginMarketplaceEdit = await jsonResponse(`/api/plugin-marketplace/${hostedProjectId}`, {
    method: "PATCH",
    headers: { Origin: "https://attacker.example", Cookie: adminCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Cross-origin marketplace edit" }),
  });
  assert.equal(crossOriginMarketplaceEdit.response.status, 403);
  const editedMarketplace = await jsonResponse(`/api/plugin-marketplace/${hostedProjectId}`, {
    method: "PATCH",
    headers: { ...originHeaders, Cookie: adminCookie },
    body: JSON.stringify({
      name: "E2E 管理员维护插件",
      description: "验证管理员编辑后的市场展示信息可以持久化。",
      author: "E2E Admin",
      category: "运营工具",
      tags: ["管理员", "E2E"],
      featured: false,
      priceCents: 2500,
    }),
  });
  assert.equal(editedMarketplace.response.status, 200);
  const centerAfterMarketplaceEdit = await jsonResponse("/api/plugin-center", { headers: { Cookie: userCookie } });
  const editedMarketplaceItem = centerAfterMarketplaceEdit.body.marketplace.find((item) => item.id === hostedProjectId);
  assert.deepEqual({
    name: editedMarketplaceItem.name,
    description: editedMarketplaceItem.description,
    author: editedMarketplaceItem.author,
    category: editedMarketplaceItem.category,
    tags: editedMarketplaceItem.tags,
    featured: editedMarketplaceItem.featured,
    priceCents: editedMarketplaceItem.priceCents,
  }, {
    name: "E2E 管理员维护插件",
    description: "验证管理员编辑后的市场展示信息可以持久化。",
    author: "E2E Admin",
    category: "运营工具",
    tags: ["管理员", "E2E"],
    featured: false,
    priceCents: 2500,
  });
  assert.deepEqual(editedMarketplaceItem.permissions, hostedManifest.permissions);
  results.push("administrators can edit marketplace presentation without changing reviewed permissions");

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

  const centerAfterEvent = await jsonResponse("/api/plugin-center", { headers: { Cookie: userCookie } });
  const hostedInstallation = centerAfterEvent.body.installations.find((item) => item.id === installationId);
  assert.equal(hostedInstallation.enabled, true);
  assert.equal(hostedInstallation.priority, 12);
  assert.equal(hostedInstallation.config.step, 4);
  assert.equal(hostedInstallation.lastRun.status, "success");
  const pluginDatabase = new Database(databasePath, { readonly: true });
  const storedCounter = pluginDatabase.prepare("SELECT value_json FROM plugin_kv WHERE installation_id = ? AND key = 'seen'").get(installationId);
  const storedRun = pluginDatabase.prepare("SELECT status, action_count FROM plugin_runs WHERE installation_id = ? ORDER BY created_at DESC LIMIT 1").get(installationId);
  pluginDatabase.close();
  assert.deepEqual(storedCounter, { value_json: "4" });
  assert.deepEqual(storedRun, { status: "success", action_count: 1 });
  results.push("QQ webhook events execute hosted plugins and persist KV and run records");

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

  const userMarketplaceDeleteDenied = await jsonResponse(`/api/plugin-marketplace/${hostedProjectId}`, {
    method: "DELETE",
    headers: { ...originHeaders, Cookie: userCookie },
    body: JSON.stringify({ reason: "Unauthorized removal" }),
  });
  assert.equal(userMarketplaceDeleteDenied.response.status, 403);
  const removedMarketplace = await jsonResponse(`/api/plugin-marketplace/${hostedProjectId}`, {
    method: "DELETE",
    headers: { ...originHeaders, Cookie: adminCookie },
    body: JSON.stringify({ reason: "E2E 管理员下架验证" }),
  });
  assert.equal(removedMarketplace.response.status, 200);
  assert.equal(removedMarketplace.body.disabledInstallations, 1);
  const centerAfterMarketplaceRemoval = await jsonResponse("/api/plugin-center", { headers: { Cookie: userCookie } });
  assert.equal(centerAfterMarketplaceRemoval.body.marketplace.some((item) => item.id === hostedProjectId), false);
  const disabledHostedInstallation = centerAfterMarketplaceRemoval.body.installations.find((item) => item.id === installationId);
  assert.equal(disabledHostedInstallation.enabled, false);
  assert.equal(disabledHostedInstallation.projectStatus, "suspended");
  assert.equal(centerAfterMarketplaceRemoval.body.projects.find((item) => item.id === hostedProjectId).status, "suspended");
  const suspendedEnableDenied = await jsonResponse(`/api/plugin-installations/${installationId}`, {
    method: "PATCH",
    headers: { ...originHeaders, Cookie: userCookie },
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(suspendedEnableDenied.response.status, 409);
  results.push("administrator marketplace removal hides listings and disables active installations");

  const uninstalledHostedPlugin = await jsonResponse(`/api/plugin-installations/${installationId}`, {
    method: "DELETE",
    headers: { Origin: baseUrl, Cookie: userCookie },
  });
  assert.equal(uninstalledHostedPlugin.response.status, 200);
  const centerAfterUninstall = await jsonResponse("/api/plugin-center", { headers: { Cookie: userCookie } });
  assert.equal(centerAfterUninstall.body.installations.some((item) => item.id === installationId), false);
  results.push("hosted plugin uninstall removes its installation-scoped data");

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
  const loginCodeRequest = await jsonResponse("/api/auth/email-code", {
    method: "POST",
    headers: originHeaders,
    body: JSON.stringify({ email: userEmail, purpose: "login" }),
  });
  assert.equal(loginCodeRequest.response.status, 200);
  const loginCode = await latestVerificationCode(userEmail);
  const codeLogin = await jsonResponse("/api/auth/login", {
    method: "POST",
    headers: originHeaders,
    body: JSON.stringify({ method: "email_code", email: userEmail, code: loginCode }),
  });
  assert.equal(codeLogin.response.status, 200);
  assert.equal(codeLogin.body.user.id, userId);
  results.push("suspension invalidates sessions and reactivation works");

  return results;
}
