import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "starbot-test-"));
const databasePath = path.join(temporaryDirectory, "starbot.db");

let databaseModule: typeof import("@/lib/database");
let botServiceModule: typeof import("@/lib/bot-service");
let cryptoModule: typeof import("@/lib/crypto-vault");
let eventRetentionModule: typeof import("@/lib/event-retention");
let eventIngestionModule: typeof import("@/lib/event-ingestion");
let gatewayCoordinationModule: typeof import("@/lib/gateway-coordination");
let membershipModule: typeof import("@/lib/membership-service");
let hostedPluginRuntimeModule: typeof import("@/lib/hosted-plugin-runtime");
let hostedPluginServiceModule: typeof import("@/lib/hosted-plugin-service");
let passwordModule: typeof import("@/lib/password");
let pluginModule: typeof import("@/lib/plugin-service");
let qqApiModule: typeof import("@/lib/qq-api");
let qqMediaModule: typeof import("@/lib/qq-media");
let qqWebhookModule: typeof import("@/lib/qq-webhook");
let qqWebhookTokenModule: typeof import("@/lib/qq-webhook-token");
let rawUploadModule: typeof import("@/lib/raw-upload");
let securityModule: typeof import("@/lib/security");
let sessionModule: typeof import("@/lib/session");
let systemSettingsModule: typeof import("@/lib/system-settings-service");
let userServiceModule: typeof import("@/lib/user-service");
let emailCodeModule: typeof import("@/lib/email-code-service");

beforeAll(async () => {
  process.env.DATABASE_PATH = databasePath;
  process.env.BOOTSTRAP_ADMIN_EMAIL = "admin@test.local";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "admin-password-2026";
  process.env.ALLOW_PRIVATE_WEBHOOKS = "false";
  process.env.ALLOW_INSECURE_WEBHOOKS = "false";
  [databaseModule, botServiceModule, cryptoModule, eventRetentionModule, eventIngestionModule, gatewayCoordinationModule, membershipModule, hostedPluginRuntimeModule, hostedPluginServiceModule, passwordModule, pluginModule, qqApiModule, qqMediaModule, qqWebhookModule, qqWebhookTokenModule, rawUploadModule, securityModule, sessionModule, systemSettingsModule, userServiceModule, emailCodeModule] = await Promise.all([
    import("@/lib/database"),
    import("@/lib/bot-service"),
    import("@/lib/crypto-vault"),
    import("@/lib/event-retention"),
    import("@/lib/event-ingestion"),
    import("@/lib/gateway-coordination"),
    import("@/lib/membership-service"),
    import("@/lib/hosted-plugin-runtime"),
    import("@/lib/hosted-plugin-service"),
    import("@/lib/password"),
    import("@/lib/plugin-service"),
    import("@/lib/qq-api"),
    import("@/lib/qq-media"),
    import("@/lib/qq-webhook"),
    import("@/lib/qq-webhook-token"),
    import("@/lib/raw-upload"),
    import("@/lib/security"),
    import("@/lib/session"),
    import("@/lib/system-settings-service"),
    import("@/lib/user-service"),
    import("@/lib/email-code-service"),
  ]);
  databaseModule.getDatabase();
});

afterAll(() => {
  const state = globalThis as typeof globalThis & { __starbotDatabase?: { close(): void } };
  state.__starbotDatabase?.close();
  delete state.__starbotDatabase;
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("authentication and membership", () => {
  it("seeds memberships consistently with bootstrap quotas", () => {
    const admin = sessionModule.authenticate("admin@test.local", "admin-password-2026");
    expect(admin).toMatchObject({ role: "admin", botQuota: 12, membershipPlan: "pro", membershipName: "专业版" });
  });

  it("registers users on the free plan", () => {
    const user = sessionModule.registerUser({ name: "测试用户", email: "user@example.com", password: "strong-password" });
    expect(user).toMatchObject({ botQuota: 1, membershipPlan: "free", membershipName: "免费版" });
    expect(sessionModule.authenticate("user@example.com", "strong-password")).toMatchObject({ id: user.id, membershipPlan: "free" });
  });

  it("sends and consumes email codes for registration and login", async () => {
    const email = `email-code-${randomUUID()}@example.com`;
    await emailCodeModule.sendEmailVerificationCode({ email, purpose: "register" });
    const registerCode = emailCodeModule.latestEmailCodeForTest(email, "register")?.code;
    expect(registerCode).toMatch(/^\d{6}$/);
    emailCodeModule.consumeEmailVerificationCode({ email, purpose: "register", code: registerCode! });
    const user = sessionModule.registerUser({ name: "邮箱验证码用户", email, password: "strong-password" });
    expect(() => emailCodeModule.consumeEmailVerificationCode({ email, purpose: "register", code: registerCode! })).toThrow("EMAIL_CODE_INVALID");

    await emailCodeModule.sendEmailVerificationCode({ email, purpose: "login" });
    const loginCode = emailCodeModule.latestEmailCodeForTest(email, "login")?.code;
    expect(loginCode).toMatch(/^\d{6}$/);
    emailCodeModule.consumeEmailVerificationCode({ email, purpose: "login", code: loginCode! }, user);
    expect(sessionModule.authenticateWithEmail(email)).toMatchObject({ id: user.id, email });
  });

  it("allows admins to assign plans and denies regular users", () => {
    const admin = sessionModule.authenticate("admin@test.local", "admin-password-2026");
    const user = sessionModule.authenticate("user@example.com", "strong-password");
    expect(admin).not.toBeNull();
    expect(user).not.toBeNull();
    expect(membershipModule.assignMembershipPlan(admin!, user!.id, "pro")).toMatchObject({ botQuota: 5, plan: { id: "pro" } });
    expect(() => membershipModule.assignMembershipPlan(user!, admin!.id, "free")).toThrow("ADMIN_REQUIRED");
  });

  it("prunes events using the assigned plan retention window", () => {
    const database = databaseModule.getDatabase();
    const user = sessionModule.authenticate("user@example.com", "strong-password");
    expect(user).not.toBeNull();
    const botId = randomUUID();
    database.prepare(`
      INSERT INTO bots (id, user_id, name, app_id, client_secret_cipher, environment, intents, status, created_at, updated_at)
      VALUES (?, ?, 'Retention Bot', 'retention-app-id', ?, 'sandbox', 0, 'offline', ?, ?)
    `).run(botId, user!.id, cryptoModule.encryptSecret("test-client-secret"), new Date().toISOString(), new Date().toISOString());
    database.prepare(`
      INSERT INTO event_logs (id, bot_id, event_type, scene, status, latency_ms, content, payload_json, trace_id, received_at)
      VALUES (?, ?, 'OLD_EVENT', '系统', 'success', 0, '', '{}', NULL, datetime('now', '-31 days'))
    `).run(randomUUID(), botId);
    expect(eventRetentionModule.pruneExpiredEvents()).toBeGreaterThanOrEqual(1);
    expect((database.prepare("SELECT COUNT(*) AS count FROM event_logs WHERE bot_id = ?").get(botId) as { count: number }).count).toBe(0);
  });

  it("hashes passwords with a unique salt and verifies them safely", () => {
    const first = passwordModule.hashPassword("same-password");
    const second = passwordModule.hashPassword("same-password");
    expect(first).not.toBe(second);
    expect(passwordModule.verifyPassword("same-password", first)).toBe(true);
    expect(passwordModule.verifyPassword("wrong-password", first)).toBe(false);
  });

  it("protects the current and last administrator account", () => {
    const admin = sessionModule.authenticate("admin@test.local", "admin-password-2026");
    expect(admin).not.toBeNull();
    expect(() => userServiceModule.updateUserAccess(admin!, admin!.id, { role: "developer", status: "active" })).toThrow("SELF_ADMIN_PROTECTION");
    expect(() => userServiceModule.updateUserAccess(admin!, admin!.id, { role: "admin", status: "suspended" })).toThrow("SELF_ADMIN_PROTECTION");
  });

  it("allows admins to suspend and reactivate users", () => {
    const admin = sessionModule.authenticate("admin@test.local", "admin-password-2026");
    const user = sessionModule.authenticate("user@example.com", "strong-password");
    expect(admin).not.toBeNull();
    expect(user).not.toBeNull();
    const database = databaseModule.getDatabase();
    database.prepare("UPDATE bots SET auto_connect = 1 WHERE user_id = ?").run(user!.id);
    expect((database.prepare("SELECT COUNT(*) AS count FROM bots WHERE user_id = ? AND auto_connect = 1").get(user!.id) as { count: number }).count).toBeGreaterThan(0);
    expect(userServiceModule.updateUserAccess(admin!, user!.id, { role: "operator", status: "suspended" })).toEqual({ role: "operator", status: "suspended" });
    expect(sessionModule.authenticate("user@example.com", "strong-password")).toBeNull();
    expect((database.prepare("SELECT COUNT(*) AS count FROM bots WHERE user_id = ? AND auto_connect = 1").get(user!.id) as { count: number }).count).toBe(0);
    expect(userServiceModule.updateUserAccess(admin!, user!.id, { role: "developer", status: "active" })).toEqual({ role: "developer", status: "active" });
  });
});

describe("system settings and membership billing", () => {
  function adminUser() {
    const admin = sessionModule.authenticate("admin@test.local", "admin-password-2026");
    expect(admin).not.toBeNull();
    return admin!;
  }

  function registeredUser(label: string) {
    return sessionModule.registerUser({
      name: `付费用户 ${label}`,
      email: `billing-${label}@example.com`,
      password: "strong-password",
    });
  }

  function enableSandboxPayment() {
    systemSettingsModule.updatePaymentSettings(adminUser(), {
      enabled: true,
      provider: "sandbox",
      epayGatewayUrl: "",
      epayPid: "",
      manualInstructions: "",
    });
  }

  it("persists public branding and never returns configured secrets", () => {
    const admin = adminUser();
    const regular = registeredUser("settings");
    expect(() => systemSettingsModule.getAdminSystemSettings(regular)).toThrow("ADMIN_REQUIRED");

    const site = systemSettingsModule.updateSiteSettings(admin, {
      siteName: "星辰机器人平台",
      siteTagline: "多机器人开发与运营",
      siteDescription: "面向开发者与运营团队的 QQ 官方机器人管理平台。",
      icpCode: "京ICP备12345678号",
      icpUrl: "https://beian.miit.gov.cn/",
      policeCode: "京公网安备110000000001号",
      policeUrl: "https://www.beian.gov.cn/",
      copyrightText: "星辰机器人平台",
    });
    expect(site.site).toMatchObject({ siteName: "星辰机器人平台", icpCode: "京ICP备12345678号", policeCode: "京公网安备110000000001号" });
    expect(systemSettingsModule.getPublicSiteSettings()).toMatchObject({ siteName: "星辰机器人平台", copyrightText: "星辰机器人平台" });

    const qqSecret = "qq-login-secret-from-database";
    const epayKey = "epay-merchant-key-from-database";
    systemSettingsModule.updateQQLoginSettings(admin, {
      enabled: true,
      appId: "database-qq-app",
      appSecret: qqSecret,
      redirectUri: "https://example.com/api/auth/qq/callback",
    });
    const settings = systemSettingsModule.updatePaymentSettings(admin, {
      enabled: true,
      provider: "epay",
      epayGatewayUrl: "https://pay.example.com/submit.php",
      epayPid: "merchant-1001",
      epayKey,
      manualInstructions: "",
    });
    expect(settings.qq.appSecretConfigured).toBe(true);
    expect(settings.payment.epayKeyConfigured).toBe(true);
    expect(JSON.stringify(settings)).not.toContain(qqSecret);
    expect(JSON.stringify(settings)).not.toContain(epayKey);
    const stored = databaseModule.getDatabase().prepare("SELECT qq_app_secret_cipher, epay_key_cipher FROM system_settings WHERE id = 1").get() as { qq_app_secret_cipher: string; epay_key_cipher: string };
    expect(stored.qq_app_secret_cipher).not.toContain(qqSecret);
    expect(stored.epay_key_cipher).not.toContain(epayKey);

    const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 91).toString("base64");
    try {
      expect(membershipModule.membershipCenter(regular).payment).toEqual({ enabled: true, provider: "epay", manualInstructions: "" });
      expect(() => systemSettingsModule.getPaymentConfig()).toThrow();
    } finally {
      if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
      else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey;
    }
  });

  it.each([
    ["monthly", 1, 2900],
    ["quarterly", 3, 7900],
    ["yearly", 12, 29900],
  ] as const)("automatically grants %s sandbox purchases for the configured server price", (billingCycle, expectedMonths, expectedAmount) => {
    enableSandboxPayment();
    const user = registeredUser(billingCycle);
    const before = new Date();
    const result = membershipModule.createMembershipOrder(user, {
      planId: "pro",
      billingCycle,
      paymentChannel: "alipay",
      returnUrl: "http://localhost:3000/",
      notifyUrl: "http://localhost:3000/api/payments/epay/notify",
    });
    expect(result).toMatchObject({ order: { status: "paid", amountCents: expectedAmount, paymentChannel: "sandbox" }, membership: { plan: { id: "pro" }, botQuota: 5 } });
    if (!("membership" in result) || !result.membership) throw new Error("Sandbox payment did not grant membership");
    const expiry = new Date(result.membership.expiresAt);
    const earliestExpected = new Date(before);
    earliestExpected.setUTCDate(1);
    earliestExpected.setUTCMonth(earliestExpected.getUTCMonth() + expectedMonths);
    earliestExpected.setUTCDate(Math.min(before.getUTCDate(), new Date(Date.UTC(earliestExpected.getUTCFullYear(), earliestExpected.getUTCMonth() + 1, 0)).getUTCDate()));
    expect(Math.abs(expiry.getTime() - earliestExpected.getTime())).toBeLessThan(5_000);
  });

  it("does not extend membership twice when payment confirmation is repeated", () => {
    enableSandboxPayment();
    const user = registeredUser("idempotency");
    const created = membershipModule.createMembershipOrder(user, {
      planId: "team",
      billingCycle: "monthly",
      paymentChannel: "qqpay",
      returnUrl: "http://localhost:3000/",
      notifyUrl: "http://localhost:3000/api/payments/epay/notify",
    });
    const database = databaseModule.getDatabase();
    const before = database.prepare("SELECT expires_at FROM user_memberships WHERE user_id = ?").get(user.id) as { expires_at: string };
    const repeated = membershipModule.confirmMembershipOrder(null, created.order.id, "duplicate-provider-trade");
    const after = database.prepare("SELECT expires_at FROM user_memberships WHERE user_id = ?").get(user.id) as { expires_at: string };
    expect(repeated.alreadyPaid).toBe(true);
    expect(after.expires_at).toBe(before.expires_at);
  });

  it("verifies epay callbacks, rejects forged signatures, and grants membership once", () => {
    const epayKey = "epay-callback-test-key";
    systemSettingsModule.updatePaymentSettings(adminUser(), {
      enabled: true,
      provider: "epay",
      epayGatewayUrl: "https://pay.example.com/submit.php",
      epayPid: "merchant-callback-test",
      epayKey,
      manualInstructions: "",
    });
    const user = registeredUser("epay-callback");
    const created = membershipModule.createMembershipOrder(user, {
      planId: "team",
      billingCycle: "yearly",
      paymentChannel: "wxpay",
      returnUrl: "https://console.example.com/",
      notifyUrl: "https://console.example.com/api/payments/epay/notify",
    });
    expect(created).toMatchObject({ order: { status: "pending", amountCents: 99900, paymentChannel: "wxpay" } });
    if (!("checkoutUrl" in created) || !created.checkoutUrl) throw new Error("Epay checkout URL was not created");
    const checkout = new URL(created.checkoutUrl);
    expect(checkout.origin + checkout.pathname).toBe("https://pay.example.com/submit.php");
    expect(checkout.searchParams.get("money")).toBe("999.00");

    const callback: Record<string, string> = {
      pid: "merchant-callback-test",
      type: "wxpay",
      out_trade_no: created.order.orderNo,
      trade_no: "epay-trade-2026",
      trade_status: "TRADE_SUCCESS",
      name: "团队版-yearly",
      money: "999.00",
      sign_type: "MD5",
    };
    expect(() => membershipModule.verifyEpayNotification({ ...callback, sign: "0".repeat(32) })).toThrow("PAYMENT_SIGNATURE_INVALID");
    callback.sign = createHash("md5").update(Object.entries(callback)
      .filter(([name, value]) => name !== "sign" && name !== "sign_type" && value !== "")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${name}=${value}`)
      .join("&") + epayKey).digest("hex");
    const confirmed = membershipModule.verifyEpayNotification(callback);
    expect(confirmed).toMatchObject({ order: { status: "paid" }, membership: { plan: { id: "team" }, botQuota: 20 }, alreadyPaid: false });
    expect(membershipModule.verifyEpayNotification(callback)).toMatchObject({ order: { status: "paid" }, alreadyPaid: true });
  });

  it("requires an administrator to confirm manual payments", () => {
    const admin = adminUser();
    systemSettingsModule.updatePaymentSettings(admin, {
      enabled: true,
      provider: "manual",
      epayGatewayUrl: "",
      epayPid: "",
      manualInstructions: "请转账后联系管理员审核",
    });
    const user = registeredUser("manual");
    const created = membershipModule.createMembershipOrder(user, {
      planId: "pro",
      billingCycle: "quarterly",
      paymentChannel: "alipay",
      returnUrl: "http://localhost:3000/",
      notifyUrl: "http://localhost:3000/api/payments/epay/notify",
    });
    expect(created).toMatchObject({ order: { status: "pending", amountCents: 7900, paymentChannel: "manual", paymentNote: "请转账后联系管理员审核" }, checkoutUrl: null });
    expect(() => membershipModule.confirmMembershipOrder(user, created.order.id, "self-confirmed")).toThrow("ADMIN_REQUIRED");
    expect(membershipModule.confirmMembershipOrder(admin, created.order.id, "manual-trade-1001", "管理员确认到账")).toMatchObject({ order: { status: "paid" }, membership: { plan: { id: "pro" } } });
  });

  it("expires paid memberships and restores the free quota", () => {
    const user = registeredUser("expiry");
    const database = databaseModule.getDatabase();
    database.prepare("UPDATE users SET bot_quota = 5 WHERE id = ?").run(user.id);
    database.prepare("UPDATE user_memberships SET plan_id = 'pro', status = 'active', expires_at = ?, updated_at = ? WHERE user_id = ?")
      .run(new Date(Date.now() - 60_000).toISOString(), new Date().toISOString(), user.id);
    const state = globalThis as typeof globalThis & { __starbotMembershipExpiryCheckedAt?: number };
    state.__starbotMembershipExpiryCheckedAt = 0;
    databaseModule.getDatabase();
    expect(database.prepare("SELECT bot_quota FROM users WHERE id = ?").get(user.id)).toEqual({ bot_quota: 1 });
    expect(database.prepare("SELECT status FROM user_memberships WHERE user_id = ?").get(user.id)).toEqual({ status: "expired" });
    expect(membershipModule.membershipCenter(user).current).toMatchObject({ plan: { id: "free" }, status: "expired", expiresAt: null });
  });
});

describe("request security", () => {
  it("sets secure cookies only for HTTPS requests or trusted HTTPS proxies", () => {
    const originalTrustProxy = process.env.TRUST_PROXY;
    try {
      delete process.env.TRUST_PROXY;
      expect(securityModule.requestUsesHttps(new Request("http://localhost:3000/api/auth/login"))).toBe(false);
      expect(securityModule.requestUsesHttps(new Request("https://console.example.com/api/auth/login"))).toBe(true);
      expect(securityModule.requestUsesHttps(new Request("http://localhost:3000/api/auth/login", {
        headers: { "x-forwarded-proto": "https" },
      }))).toBe(false);

      process.env.TRUST_PROXY = "true";
      expect(securityModule.requestUsesHttps(new Request("http://internal-next-host:3000/api/auth/login", {
        headers: { "x-forwarded-proto": "https, http" },
      }))).toBe(true);
    } finally {
      if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = originalTrustProxy;
    }
  });

  it("limits repeated requests within a window", () => {
    securityModule.consumeRateLimit("test-bucket", 2, 60_000);
    securityModule.consumeRateLimit("test-bucket", 2, 60_000);
    expect(() => securityModule.consumeRateLimit("test-bucket", 2, 60_000)).toThrow(securityModule.RateLimitError);
  });

  it("rejects cross-site mutation origins", () => {
    const trusted = new Request("https://console.example.com/api/auth/login", { headers: { origin: "https://console.example.com" } });
    expect(() => securityModule.assertTrustedRequest(trusted)).not.toThrow();
    const proxiedLocally = new Request("http://internal-next-host:3000/api/auth/login", {
      headers: { origin: "http://localhost:3000", host: "localhost:3000", "sec-fetch-site": "same-origin" },
    });
    expect(() => securityModule.assertTrustedRequest(proxiedLocally)).not.toThrow();
    const untrusted = new Request("https://console.example.com/api/auth/login", { headers: { origin: "https://attacker.example" } });
    expect(() => securityModule.assertTrustedRequest(untrusted)).toThrow("UNTRUSTED_ORIGIN");
    const spoofedHost = new Request("https://internal-next-host/api/auth/login", {
      headers: { origin: "https://attacker.example", host: "console.example.com", "sec-fetch-site": "cross-site" },
    });
    expect(() => securityModule.assertTrustedRequest(spoofedHost)).toThrow("UNTRUSTED_ORIGIN");
  });

  it("accepts only relative QQ API paths", () => {
    expect(qqApiModule.validateQQApiPath("/gateway/bot")).toBe("/gateway/bot");
    expect(qqApiModule.validateQQApiPath("/v2/users/demo/messages?foo=bar")).toBe("/v2/users/demo/messages?foo=bar");
    expect(() => qqApiModule.validateQQApiPath("https://attacker.example/path")).toThrow("QQ_API_PATH_INVALID");
    expect(() => qqApiModule.validateQQApiPath("/v2/../secret")).toThrow("QQ_API_PATH_INVALID");
  });

  it("recognizes QQ API errors created by a stale hot-reload module", () => {
    const staleModuleError = Object.assign(new Error("QQ API request failed"), {
      name: "QQApiError",
      status: 500,
      traceId: "trace-hot-reload",
      responseBody: { code: 11703 },
    });

    expect(staleModuleError).not.toBeInstanceOf(qqApiModule.QQApiError);
    expect(qqApiModule.isQQApiError(staleModuleError)).toBe(true);
    expect(qqApiModule.isQQApiError({ name: "QQApiError", status: 500 })).toBe(false);
  });

  it("selects a valid recent QQ event and increments reply sequence", () => {
    const user = sessionModule.authenticate("user@example.com", "strong-password");
    expect(user).not.toBeNull();
    const database = databaseModule.getDatabase();
    const botId = randomUUID();
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO bots (id, user_id, name, app_id, client_secret_cipher, environment, intents, status, created_at, updated_at) VALUES (?, ?, 'Reply Bot', ?, ?, 'sandbox', 0, 'offline', ?, ?)`)
      .run(botId, user!.id, `reply-app-${botId}`, cryptoModule.encryptSecret("reply-secret"), now, now);
    botServiceModule.recordEvent(botId, {
      type: "GROUP_AT_MESSAGE_CREATE",
      scene: "群聊",
      payload: { op: 0, t: "GROUP_AT_MESSAGE_CREATE", d: { id: "message-reply-1", group_openid: "group-reply-1" } },
    });

    expect(botServiceModule.getMessageReplyContext(user!, botId, "group", "group-reply-1")).toMatchObject({ msgId: "message-reply-1", msgSeq: 1 });
    botServiceModule.recordEvent(botId, {
      type: "OUTBOUND_MESSAGE",
      scene: "群聊",
      payload: { request: { msg_id: "message-reply-1", msg_seq: 1 }, response: {} },
    });
    expect(botServiceModule.getMessageReplyContext(user!, botId, "group", "group-reply-1")).toMatchObject({ msgId: "message-reply-1", msgSeq: 2 });
    for (let sequence = 2; sequence <= 5; sequence += 1) {
      botServiceModule.recordEvent(botId, {
        type: "OUTBOUND_MESSAGE",
        scene: "群聊",
        payload: { request: { msg_id: "message-reply-1", msg_seq: sequence }, response: {} },
      });
    }
    expect(() => botServiceModule.getMessageReplyContext(user!, botId, "group", "group-reply-1")).toThrow("MESSAGE_REPLY_LIMIT_REACHED");
    database.prepare(`
      INSERT INTO event_logs (id, bot_id, event_type, scene, status, latency_ms, content, payload_json, trace_id, received_at)
      VALUES (?, ?, 'GROUP_AT_MESSAGE_CREATE', '群聊', 'success', 0, '', ?, NULL, ?)
    `).run(randomUUID(), botId, JSON.stringify({ d: { id: "expired-message", group_openid: "expired-group" } }), new Date(Date.now() - 6 * 60_000).toISOString());
    expect(() => botServiceModule.getMessageReplyContext(user!, botId, "group", "expired-group")).toThrow("MESSAGE_REPLY_CONTEXT_NOT_FOUND");
    expect(() => botServiceModule.getMessageReplyContext(user!, botId, "group", "another-group")).toThrow("MESSAGE_REPLY_CONTEXT_NOT_FOUND");
  });

  it("uses the official QQ send, recall, and group mute request contracts", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      if (String(input).endsWith("/app/getAppAccessToken")) return Response.json({ access_token: "test-access-token", expires_in: 7200 });
      return Response.json({ ok: true }, { headers: { "X-Tps-trace-ID": "trace-contract-test" } });
    }) as typeof fetch;

    try {
      const client = new qqApiModule.QQBotApiClient({ appId: "test-app", clientSecret: "test-secret" });
      await client.getBotProfile();
      await client.request("/interactions/interaction%2Fid", "PUT", { code: 0 });
      await client.request("/channels/channel%2Fid", "PATCH", { name: "updated" });
      await client.sendGroupMessage("group/open id", { content: "hello", msg_type: 0 });
      await client.recallC2CMessage("user/open id", "message/id");
      await client.recallGroupMessage("group/open id", "message/id");
      await client.getGroupMuteSettings("group/open id");
      await client.muteGroupMember("group/open id", "member-openid", "2026-08-14T12:00:00+08:00");
      await client.unmuteGroupMember("group/open id", "member-openid");

      const apiRequests = requests.slice(1);
      expect(apiRequests.map((request) => [request.init?.method, request.url])).toEqual([
        ["GET", "https://api.bot.qq.com/users/@me"],
        ["PUT", "https://api.bot.qq.com/interactions/interaction%2Fid"],
        ["PATCH", "https://api.bot.qq.com/channels/channel%2Fid"],
        ["POST", "https://api.bot.qq.com/v2/groups/group%2Fopen%20id/messages"],
        ["DELETE", "https://api.bot.qq.com/v2/users/user%2Fopen%20id/messages/message%2Fid"],
        ["DELETE", "https://api.bot.qq.com/v2/groups/group%2Fopen%20id/messages/message%2Fid"],
        ["GET", "https://api.bot.qq.com/v2/groups/group%2Fopen%20id/restrict_chat_setting"],
        ["POST", "https://api.bot.qq.com/v2/groups/group%2Fopen%20id/restrict_chat_setting"],
        ["POST", "https://api.bot.qq.com/v2/groups/group%2Fopen%20id/restrict_chat_setting"],
      ]);
      expect(apiRequests.every((request) => new Headers(request.init?.headers).get("Authorization") === "QQBot test-access-token")).toBe(true);
      expect(JSON.parse(String(apiRequests[1].init?.body))).toEqual({ code: 0 });
      expect(JSON.parse(String(apiRequests[2].init?.body))).toEqual({ name: "updated" });
      expect(apiRequests[4].init?.body).toBeUndefined();
      expect(JSON.parse(String(apiRequests[7].init?.body))).toEqual({
        members: [{ op: "add", member_openid: "member-openid", mute_expire_at: "2026-08-14T12:00:00+08:00" }],
      });
      expect(JSON.parse(String(apiRequests[8].init?.body))).toEqual({
        members: [{ op: "del", member_openid: "member-openid", mute_expire_at: "" }],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("creates a bot using the official QQ profile name", async () => {
    const user = sessionModule.registerUser({ name: "Bot Owner", email: `bot-owner-${randomUUID()}@example.com`, password: "strong-password" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      if (String(input).endsWith("/app/getAppAccessToken")) return Response.json({ access_token: "profile-access-token", expires_in: 7200 });
      if (String(input).endsWith("/users/@me")) return Response.json({ id: "qq-bot-id", username: "QQ 官方测试助手", bot: true });
      return Response.json({}, { status: 404 });
    }) as typeof fetch;

    try {
      const bot = await botServiceModule.createBot(user, {
        appId: `profile-app-${randomUUID()}`,
        clientSecret: "profile-client-secret",
        environment: "sandbox",
        connectionMode: "websocket",
      });
      expect(bot.name).toBe("QQ 官方测试助手");
      expect(databaseModule.getDatabase().prepare("SELECT name FROM bots WHERE id = ?").get(bot.id)).toEqual({ name: "QQ 官方测试助手" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("maps hosted plugin QQ helpers to official OpenAPI actions", async () => {
    const result = await hostedPluginRuntimeModule.executeHostedPlugin({
      code: `StarBot.definePlugin({ onEvent(event, sdk) {
        sdk.qq.getBotProfile();
        sdk.qq.sendGroup("group/open id", { content: "hello", msg_type: 0 });
        sdk.qq.recallC2C("user/open id", "message/id");
        sdk.qq.recallGroup("group/open id", "message/id");
        sdk.qq.getGroupMuteSettings("group/open id");
        sdk.qq.muteGroupMember("group/open id", "member-openid", "2026-08-14T12:00:00+08:00");
        sdk.qq.unmuteGroupMember("group/open id", "member-openid");
      } });`,
      event: { type: "GROUP_AT_MESSAGE_CREATE", data: {} },
      config: {},
      kv: {},
    });

    expect(result.actions).toEqual([
      { kind: "qq_api", method: "GET", path: "/users/@me" },
      { kind: "qq_api", method: "POST", path: "/v2/groups/group%2Fopen%20id/messages", body: { content: "hello", msg_type: 0 } },
      { kind: "qq_api", method: "DELETE", path: "/v2/users/user%2Fopen%20id/messages/message%2Fid" },
      { kind: "qq_api", method: "DELETE", path: "/v2/groups/group%2Fopen%20id/messages/message%2Fid" },
      { kind: "qq_api", method: "GET", path: "/v2/groups/group%2Fopen%20id/restrict_chat_setting" },
      { kind: "qq_api", method: "POST", path: "/v2/groups/group%2Fopen%20id/restrict_chat_setting", body: { members: [{ op: "add", member_openid: "member-openid", mute_expire_at: "2026-08-14T12:00:00+08:00" }] } },
      { kind: "qq_api", method: "POST", path: "/v2/groups/group%2Fopen%20id/restrict_chat_setting", body: { members: [{ op: "del", member_openid: "member-openid", mute_expire_at: "" }] } },
    ]);
  });

  it("blocks hosted plugin QQ actions before network access without qq:api permission", async () => {
    const database = databaseModule.getDatabase();
    const user = sessionModule.authenticate("user@example.com", "strong-password");
    expect(user).not.toBeNull();
    const now = new Date().toISOString();
    const botId = randomUUID();
    const projectId = randomUUID();
    const versionId = randomUUID();
    const installationId = randomUUID();
    const manifest = {
      schemaVersion: 1,
      id: `permission-test-${projectId}`,
      name: "Permission Test",
      version: "1.0.0",
      description: "Verifies QQ API permission enforcement.",
      author: "StarBot Test",
      category: "Testing",
      tags: [],
      entry: "index.js",
      events: ["GROUP_AT_MESSAGE_CREATE"],
      permissions: [],
      commands: [],
      configSchema: [],
    };
    database.prepare(`INSERT INTO bots (id, user_id, name, app_id, client_secret_cipher, environment, intents, status, created_at, updated_at) VALUES (?, ?, 'Permission Bot', ?, ?, 'sandbox', 0, 'offline', ?, ?)`)
      .run(botId, user!.id, `permission-app-${botId}`, cryptoModule.encryptSecret("permission-secret"), now, now);
    database.prepare(`INSERT INTO plugin_projects (id, owner_user_id, slug, name, description, author, category, tags_json, status, created_at, updated_at) VALUES (?, ?, ?, 'Permission Test', 'Verifies QQ API permission enforcement.', 'StarBot Test', 'Testing', '[]', 'private', ?, ?)`)
      .run(projectId, user!.id, `permission-test-${projectId}`, now, now);
    database.prepare(`INSERT INTO plugin_versions (id, project_id, version, manifest_json, entry_code, readme, package_sha256, package_size, validation_json, status, created_at) VALUES (?, ?, '1.0.0', ?, ?, NULL, ?, 1, '{}', 'active', ?)`)
      .run(versionId, projectId, JSON.stringify(manifest), `StarBot.definePlugin({ onEvent(event, sdk) { sdk.qq.sendGroup("group-openid", { content: "blocked", msg_type: 0 }); } });`, "0".repeat(64), now);
    database.prepare(`INSERT INTO plugin_installations (id, user_id, bot_id, project_id, version_id, enabled, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 50, ?, ?)`)
      .run(installationId, user!.id, botId, projectId, versionId, now, now);

    const originalFetch = globalThis.fetch;
    let networkRequests = 0;
    globalThis.fetch = (async () => { networkRequests += 1; return Response.json({}); }) as typeof fetch;
    try {
      await hostedPluginServiceModule.dispatchHostedPlugins(botId, "GROUP_AT_MESSAGE_CREATE", { group_openid: "group-openid" });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(networkRequests).toBe(0);
    expect(database.prepare("SELECT status, error FROM plugin_runs WHERE installation_id = ? ORDER BY created_at DESC LIMIT 1").get(installationId)).toEqual({
      status: "failed",
      error: "PLUGIN_PERMISSION_DENIED:qq:api",
    });
  });

  it("authenticates signed plugin requests and rejects nonce replay", () => {
    const database = databaseModule.getDatabase();
    const user = sessionModule.authenticate("user@example.com", "strong-password");
    expect(user).not.toBeNull();
    const now = new Date().toISOString();
    const botId = randomUUID();
    const pluginId = randomUUID();
    const secret = "plugin-test-secret";
    database.prepare(`
      INSERT INTO bots (id, user_id, name, app_id, client_secret_cipher, environment, intents, status, created_at, updated_at)
      VALUES (?, ?, 'Test Bot', 'test-app-id', ?, 'sandbox', 0, 'offline', ?, ?)
    `).run(botId, user!.id, cryptoModule.encryptSecret("test-client-secret"), now, now);
    database.prepare(`
      INSERT INTO plugins (id, user_id, bot_id, name, slug, version, runtime, events_json, permissions_json, signing_secret_cipher, enabled, created_at, updated_at)
      VALUES (?, ?, ?, 'Test SDK App', 'test-sdk-app', '1.0.0', 'sdk', '["*"]', '["event:receive","qq:api"]', ?, 1, ?, ?)
    `).run(pluginId, user!.id, botId, cryptoModule.encryptSecret(secret), now, now);

    const timestamp = Date.now().toString();
    const nonce = "a-valid-test-nonce-2026";
    const body = JSON.stringify({ method: "GET", path: "/gateway/bot" });
    const signature = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("hex")}`;
    expect(pluginModule.authenticatePluginRequest(pluginId, timestamp, nonce, body, signature)).toEqual({ botId, permissions: ["event:receive", "qq:api"] });
    expect(() => pluginModule.authenticatePluginRequest(pluginId, timestamp, nonce, body, signature)).toThrow("PLUGIN_REQUEST_REPLAYED");

    const multipartNonce = "multipart-test-nonce-2026";
    const contentType = "multipart/form-data; boundary=starbot-test-boundary";
    const multipartBody = Buffer.from("--starbot-test-boundary\r\ncontent\r\n--starbot-test-boundary--\r\n");
    const canonical = ["POST", "/v2/users/openid/files", contentType, createHash("sha256").update(multipartBody).digest("hex")].join("\n");
    const multipartSignature = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${multipartNonce}.${canonical}`).digest("hex")}`;
    expect(pluginModule.authenticatePluginCanonicalRequest(pluginId, timestamp, multipartNonce, canonical, multipartSignature)).toEqual({ botId, permissions: ["event:receive", "qq:api"] });
    expect(() => pluginModule.authenticatePluginCanonicalRequest(pluginId, timestamp, multipartNonce, canonical, multipartSignature)).toThrow("PLUGIN_REQUEST_REPLAYED");
  });

  it("claims SDK events atomically and acknowledges only the active lease", async () => {
    const database = databaseModule.getDatabase();
    const user = sessionModule.authenticate("user@example.com", "strong-password");
    expect(user).not.toBeNull();
    database.prepare("DELETE FROM plugin_deliveries").run();
    const now = new Date().toISOString();
    const botId = randomUUID();
    const pluginId = randomUUID();
    const deliveryId = randomUUID();
    database.prepare(`
      INSERT INTO bots (id, user_id, name, app_id, client_secret_cipher, environment, intents, status, created_at, updated_at)
      VALUES (?, ?, 'Lease Bot', ?, ?, 'sandbox', 0, 'offline', ?, ?)
    `).run(botId, user!.id, `lease-app-${botId}`, cryptoModule.encryptSecret("lease-client-secret"), now, now);
    database.prepare(`
      INSERT INTO plugins (id, user_id, bot_id, name, slug, version, runtime, events_json, permissions_json, signing_secret_cipher, enabled, created_at, updated_at)
      VALUES (?, ?, ?, 'Lease SDK App', ?, '1.0.0', 'sdk', '["*"]', '["event:receive"]', ?, 1, ?, ?)
    `).run(pluginId, user!.id, botId, `lease-plugin-${pluginId}`, cryptoModule.encryptSecret("lease-plugin-secret"), now, now);
    database.prepare(`
      INSERT INTO plugin_deliveries (id, plugin_id, bot_id, event_type, payload_json, status, attempts, next_attempt_at, lease_owner, lease_expires_at, created_at, updated_at)
      VALUES (?, ?, ?, 'GROUP_MESSAGE_CREATE', ?, 'delivering', 1, ?, 'expired-owner', ?, ?, ?)
    `).run(deliveryId, pluginId, botId, JSON.stringify({ id: deliveryId, type: "GROUP_MESSAGE_CREATE", botId, createdAt: now, data: { content: "hello" } }), now, Date.now() - 1_000, now, now);

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => pluginModule.claimSdkEvents(pluginId, 10)),
      Promise.resolve().then(() => pluginModule.claimSdkEvents(pluginId, 10)),
    ]);
    const claim = first.events.length ? first : second;
    const emptyClaim = first.events.length ? second : first;
    expect(claim.events).toHaveLength(1);
    expect(claim.events[0]).toMatchObject({ id: deliveryId, type: "GROUP_MESSAGE_CREATE", attempt: 2 });
    expect(emptyClaim.events).toHaveLength(0);
    expect(pluginModule.acknowledgeSdkEvents(pluginId, "wrong-lease-token", [deliveryId])).toBe(0);
    expect(pluginModule.acknowledgeSdkEvents(pluginId, claim.leaseToken!, [deliveryId])).toBe(1);
    expect(database.prepare("SELECT status, attempts, lease_owner, lease_expires_at FROM plugin_deliveries WHERE id = ?").get(deliveryId)).toEqual({
      status: "succeeded",
      attempts: 2,
      lease_owner: null,
      lease_expires_at: null,
    });
  });

  it("matches the QQ webhook Ed25519 challenge example", () => {
    expect(qqWebhookModule.signQQWebhookChallenge("DG5g3B4j9X2KOErG", "1725442341", "Arq0D5A61EgUu4OxUvOp")).toBe(
      "87befc99c42c651b3aac0278e71ada338433ae26fcb24307bdc5ad38c1adc2d01bcfcadc0842edac85e85205028a1132afe09280305f13aa6909ffc2d652c706",
    );
  });

  it("rejects invalid QQ webhook identity and signatures", async () => {
    const database = databaseModule.getDatabase();
    const bot = database.prepare("SELECT id, app_id, client_secret_cipher FROM bots ORDER BY created_at ASC LIMIT 1").get() as { id: string; app_id: string; client_secret_cipher: string };
    const token = qqWebhookTokenModule.deriveQQWebhookToken(bot.id, bot.client_secret_cipher);
    const challengeBody = JSON.stringify({ op: 13, d: { plain_token: "challenge-token", event_ts: "1725442341" } });
    await expect(qqWebhookModule.handleQQWebhook(bot.id, token, bot.app_id, challengeBody, new Headers())).rejects.toThrow("QQ_WEBHOOK_MODE_REQUIRED");
    database.prepare("UPDATE bots SET connection_mode = 'webhook' WHERE id = ?").run(bot.id);
    await expect(qqWebhookModule.handleQQWebhook(bot.id, "invalid-token", bot.app_id, challengeBody, new Headers())).rejects.toThrow("QQ_WEBHOOK_TOKEN_INVALID");
    await expect(qqWebhookModule.handleQQWebhook(bot.id, token, "wrong-app-id", challengeBody, new Headers())).rejects.toThrow("QQ_WEBHOOK_APP_ID_MISMATCH");
    await expect(qqWebhookModule.handleQQWebhook(bot.id, token, bot.app_id, challengeBody, new Headers())).resolves.toMatchObject({
      challenge: { plain_token: "challenge-token" },
    });

    const eventBody = JSON.stringify({ op: 0, t: "C2C_MESSAGE_CREATE", id: "invalid-signature-event", d: { id: "invalid-signature-message" } });
    const headers = new Headers({
      "x-signature-timestamp": Math.floor(Date.now() / 1000).toString(),
      "x-signature-ed25519": "0".repeat(128),
    });
    await expect(qqWebhookModule.handleQQWebhook(bot.id, token, bot.app_id, eventBody, headers)).rejects.toThrow("QQ_WEBHOOK_SIGNATURE_INVALID");
    database.prepare("UPDATE bots SET connection_mode = 'websocket', status = 'offline' WHERE id = ?").run(bot.id);
  });

  it("coordinates gateway ownership and persists shard sessions", () => {
    expect(botServiceModule.defaultQQGatewayIntents).toBe(1 << 25);
    const database = databaseModule.getDatabase();
    const bot = database.prepare("SELECT id FROM bots ORDER BY created_at ASC LIMIT 1").get() as { id: string };
    database.prepare("UPDATE bots SET intents = 0 WHERE id = ?").run(bot.id);
    expect(botServiceModule.getBotGatewayConfig(bot.id).intents).toBe(botServiceModule.defaultQQGatewayIntents);
    database.prepare("UPDATE bots SET auto_connect = 1 WHERE id = ?").run(bot.id);
    expect(gatewayCoordinationModule.acquireGatewayLease(bot.id, 1_000)).toBe(true);
    expect(gatewayCoordinationModule.renewGatewayLease(bot.id, 2_000)).toBe(true);
    expect(gatewayCoordinationModule.prepareGatewayShards(bot.id, 3)).toHaveLength(3);
    gatewayCoordinationModule.updateGatewayShardSession(bot.id, 1, { status: "online", sessionId: "session-1", sequence: 42, lastAckAt: 2_500 });
    expect(gatewayCoordinationModule.listGatewayShardSessions(bot.id)[1]).toMatchObject({ shardId: 1, shardCount: 3, status: "online", sessionId: "session-1", sequence: 42 });
    const resized = gatewayCoordinationModule.prepareGatewayShards(bot.id, 2);
    expect(resized).toHaveLength(2);
    expect(resized.every((session) => session.sessionId === null && session.sequence === null)).toBe(true);
    const owner = database.prepare("SELECT user_id FROM bots WHERE id = ?").get(bot.id) as { user_id: string };
    database.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(owner.user_id);
    expect(gatewayCoordinationModule.renewGatewayLease(bot.id, 3_000)).toBe(false);
    gatewayCoordinationModule.releaseGatewayLease(bot.id);
    expect(gatewayCoordinationModule.acquireGatewayLease(bot.id, 3_000)).toBe(false);
    database.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(owner.user_id);
    gatewayCoordinationModule.releaseGatewayLease(bot.id);
  });

  it("deduplicates resumed gateway events before plugin delivery", async () => {
    const database = databaseModule.getDatabase();
    const bot = database.prepare("SELECT id FROM bots ORDER BY created_at ASC LIMIT 1").get() as { id: string };
    const payload = { op: 0, t: "GROUP_MESSAGE_CREATE", s: 99, id: "event-deduplication-2026", d: { id: "message-deduplication-2026", content: "hello" } };
    expect((await eventIngestionModule.ingestQQEvent(bot.id, "gateway", payload)).accepted).toBe(true);
    expect((await eventIngestionModule.ingestQQEvent(bot.id, "qq_webhook", payload)).reason).toBe("DUPLICATE");
    expect((database.prepare("SELECT COUNT(*) AS count FROM event_logs WHERE bot_id = ? AND event_type = 'GROUP_MESSAGE_CREATE'").get(bot.id) as { count: number }).count).toBe(1);
  });

  it("streams multipart media to a temporary file with official hashes", async () => {
    const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("starbot-media-parser-test")]);
    const form = new FormData();
    form.set("targetType", "c2c");
    form.set("targetOpenid", "openid-test-2026");
    form.set("fileType", "1");
    form.set("srvSendMsg", "false");
    form.set("file", new File([bytes], "avatar.png", { type: "image/png" }));
    const upload = await qqMediaModule.parseMediaUploadRequest(new Request("http://localhost/media", { method: "POST", body: form }));
    try {
      expect(upload).toMatchObject({ fileName: "avatar.png", fileSize: bytes.length, fileType: 1, targetType: "c2c", targetOpenid: "openid-test-2026", srvSendMsg: false });
      expect(upload.md5).toBe(createHash("md5").update(bytes).digest("hex"));
      expect(upload.sha1).toBe(createHash("sha1").update(bytes).digest("hex"));
      expect(fs.readFileSync(upload.tempPath)).toEqual(bytes);
    } finally {
      await qqMediaModule.removeParsedMediaUpload(upload);
    }
    expect(fs.existsSync(upload.tempPath)).toBe(false);
  });

  it("rejects files whose contents do not match the selected QQ media type", async () => {
    const form = new FormData();
    form.set("targetType", "group");
    form.set("targetOpenid", "openid-test-2026");
    form.set("fileType", "1");
    form.set("file", new File([Buffer.from("not an image")], "renamed.png", { type: "image/png" }));
    await expect(qqMediaModule.parseMediaUploadRequest(new Request("http://localhost/media", { method: "POST", body: form }))).rejects.toThrow("MEDIA_IMAGE_CONTENT_INVALID");
    expect(qqMediaModule.mediaUploadInputErrorMessage("MEDIA_IMAGE_CONTENT_INVALID")).toBe("所选图片的实际内容不是有效的 PNG 或 JPEG");
  });

  it("spools raw multipart bodies with SHA256 and always supports cleanup", async () => {
    const bytes = Buffer.from("raw-multipart-upload-test");
    const request = new Request("http://localhost/multipart", { method: "POST", body: bytes });
    const upload = await rawUploadModule.spoolRequestBody(request.body!);
    expect(upload).toMatchObject({ size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    expect(fs.readFileSync(upload.tempPath)).toEqual(bytes);
    await rawUploadModule.removeRawUpload(upload.tempPath);
    expect(fs.existsSync(upload.tempPath)).toBe(false);

    const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("starbot-raw-") && name.endsWith(".upload")));
    const oversized = new Request("http://localhost/multipart", { method: "POST", body: Buffer.from("12345") });
    await expect(rawUploadModule.spoolRequestBody(oversized.body!, 4)).rejects.toThrow("MULTIPART_BODY_TOO_LARGE");
    const after = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("starbot-raw-") && name.endsWith(".upload")));
    expect(after).toEqual(before);
  });

  it.each([
    { firstPartIndex: 0, label: "documented zero-based" },
    { firstPartIndex: 1, label: "QQ production one-based" },
  ])("uploads exact file ranges for $label media parts", async ({ firstPartIndex }) => {
    const bytes = Buffer.from("abcdefghij");
    const tempPath = path.join(temporaryDirectory, "media-parts.bin");
    fs.writeFileSync(tempPath, bytes);
    const requests: Array<{ path: string; payload?: unknown }> = [];
    const client = {
      request: async (requestPath: string, _method: string, payload?: unknown) => {
        requests.push({ path: requestPath, payload });
        if (requestPath.endsWith("/upload_prepare")) return {
          body: {
            upload_id: "upload-test-2026",
            block_size: "4",
            parts: [
              { index: firstPartIndex, presigned_url: "https://upload.example/0", block_size: "4" },
              { index: firstPartIndex + 1, presigned_url: "https://upload.example/1", block_size: "4" },
              { index: firstPartIndex + 2, presigned_url: "https://upload.example/2", block_size: "2" },
            ],
            upload_config: { concurrency: 2, retry_timeout: 5, retry_delay: 1 },
          },
          traceId: null,
        };
        if (requestPath.endsWith("/files")) return { body: { file_info: "file-info-test" }, traceId: "trace-test" };
        return { body: {}, traceId: null };
      },
    };
    const uploadedParts = new Map<string, { bytes: Buffer; contentLength: string | null }>();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const chunks: Buffer[] = [];
      for await (const chunk of init?.body as unknown as NodeJS.ReadableStream) chunks.push(Buffer.from(chunk));
      uploadedParts.set(String(input), {
        bytes: Buffer.concat(chunks),
        contentLength: new Headers(init?.headers).get("Content-Length"),
      });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    try {
      const result = await qqMediaModule.uploadQQMedia(client as unknown as import("@/lib/qq-api").QQBotApiClient, {
        tempPath,
        fileName: "demo.mp4",
        fileSize: bytes.length,
        fileType: 2,
        targetType: "group",
        targetOpenid: "group-test-2026",
        srvSendMsg: false,
        md5: createHash("md5").update(bytes).digest("hex"),
        sha1: createHash("sha1").update(bytes).digest("hex"),
        md5First10m: createHash("md5").update(bytes).digest("hex"),
      });
      expect(result).toMatchObject({ body: { file_info: "file-info-test" }, traceId: "trace-test" });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(uploadedParts.get("https://upload.example/0")).toEqual({ bytes: Buffer.from("abcd"), contentLength: "4" });
    expect(uploadedParts.get("https://upload.example/1")).toEqual({ bytes: Buffer.from("efgh"), contentLength: "4" });
    expect(uploadedParts.get("https://upload.example/2")).toEqual({ bytes: Buffer.from("ij"), contentLength: "2" });
    const finishRequests = requests.filter((entry) => entry.path.endsWith("/upload_part_finish"));
    expect(finishRequests).toHaveLength(3);
    expect(finishRequests.map((entry) => {
      const payload = entry.payload as { part_index: number; md5: string };
      return { part_index: payload.part_index, md5: payload.md5 };
    }).sort((left, right) => left.part_index - right.part_index)).toEqual([
      { part_index: firstPartIndex, md5: createHash("md5").update("abcd").digest("hex") },
      { part_index: firstPartIndex + 1, md5: createHash("md5").update("efgh").digest("hex") },
      { part_index: firstPartIndex + 2, md5: createHash("md5").update("ij").digest("hex") },
    ]);
    expect(requests.at(-1)?.path).toBe("/v2/groups/group-test-2026/files");
  });

  it("retries transient QQ media failures and formats permanent errors safely", async () => {
    const bytes = Buffer.from("retry");
    const tempPath = path.join(temporaryDirectory, "media-retry.bin");
    fs.writeFileSync(tempPath, bytes);
    let prepareAttempts = 0;
    const transientError = Object.assign(new Error("QQ API request failed"), {
      name: "QQApiError",
      status: 500,
      traceId: "trace-media-retry",
      responseBody: { code: 40093001, message: "file upload channel unavailable" },
    });
    const client = {
      request: async (requestPath: string) => {
        if (requestPath.endsWith("/upload_prepare")) {
          prepareAttempts += 1;
          if (prepareAttempts === 1) throw transientError;
          return {
            body: {
              upload_id: "upload-retry-test",
              block_size: String(bytes.length),
              parts: [{ index: 1, presigned_url: "https://upload.example/retry", block_size: String(bytes.length) }],
              upload_config: { concurrency: 1, retry_timeout: 5, retry_delay: 1 },
            },
            traceId: null,
          };
        }
        if (requestPath.endsWith("/files")) return { body: { file_info: "file-info-retry" }, traceId: "trace-retry-success" };
        return { body: {}, traceId: null };
      },
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      for await (const _chunk of init?.body as unknown as NodeJS.ReadableStream) void _chunk;
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    try {
      await expect(qqMediaModule.uploadQQMedia(client as unknown as import("@/lib/qq-api").QQBotApiClient, {
        tempPath,
        fileName: "retry.bin",
        fileSize: bytes.length,
        fileType: 4,
        targetType: "group",
        targetOpenid: "group-retry-test",
        srvSendMsg: false,
        md5: createHash("md5").update(bytes).digest("hex"),
        sha1: createHash("sha1").update(bytes).digest("hex"),
        md5First10m: createHash("md5").update(bytes).digest("hex"),
      })).resolves.toMatchObject({ body: { file_info: "file-info-retry" } });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(prepareAttempts).toBe(2);

    const permanentError = new qqApiModule.QQApiError("QQ API request failed", 500, "trace-format", { code: 850019, message: "unsupported file format" });
    expect(qqMediaModule.describeQQMediaApiError(permanentError, "prepare")).toEqual({
      message: "富媒体预上传准备失败",
      code: "850019",
      stage: "prepare",
      detail: "文件格式与所选媒体类型不匹配",
      traceId: "trace-format",
    });
    const invalidTargetError = new qqApiModule.QQApiError("QQ API request failed", 500, "trace-invalid-target", { code: 11255, message: "invalid request" });
    expect(qqMediaModule.describeQQMediaApiError(invalidTargetError, "prepare")).toEqual({
      message: "富媒体预上传准备失败",
      code: "11255",
      stage: "prepare",
      detail: "目标 OpenID 无效、场景选择错误，或目标不属于当前机器人",
      traceId: "trace-invalid-target",
    });
    let invalidTargetAttempts = 0;
    const invalidTargetClient = {
      request: async () => {
        invalidTargetAttempts += 1;
        throw invalidTargetError;
      },
    };
    await expect(qqMediaModule.uploadQQMedia(invalidTargetClient as unknown as import("@/lib/qq-api").QQBotApiClient, {
      tempPath,
      fileName: "retry.bin",
      fileSize: bytes.length,
      fileType: 4,
      targetType: "group",
      targetOpenid: "invalid-target",
      srvSendMsg: false,
      md5: createHash("md5").update(bytes).digest("hex"),
      sha1: createHash("sha1").update(bytes).digest("hex"),
      md5First10m: createHash("md5").update(bytes).digest("hex"),
    })).rejects.toMatchObject({ name: "QQMediaUploadError", stage: "prepare", mediaCause: invalidTargetError });
    expect(invalidTargetAttempts).toBe(1);
    let permanentAttempts = 0;
    const permanentClient = {
      request: async () => {
        permanentAttempts += 1;
        throw permanentError;
      },
    };
    await expect(qqMediaModule.uploadQQMedia(permanentClient as unknown as import("@/lib/qq-api").QQBotApiClient, {
      tempPath,
      fileName: "retry.bin",
      fileSize: bytes.length,
      fileType: 4,
      targetType: "group",
      targetOpenid: "group-retry-test",
      srvSendMsg: false,
      md5: createHash("md5").update(bytes).digest("hex"),
      sha1: createHash("sha1").update(bytes).digest("hex"),
      md5First10m: createHash("md5").update(bytes).digest("hex"),
    })).rejects.toMatchObject({ name: "QQMediaUploadError", stage: "prepare", mediaCause: permanentError });
    expect(permanentAttempts).toBe(1);
  });

  it("identifies whether an event OpenID belongs to c2c or group", () => {
    const user = sessionModule.registerUser({ name: "Target Owner", email: `target-owner-${randomUUID()}@example.com`, password: "strong-password" });
    const database = databaseModule.getDatabase();
    const botId = randomUUID();
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO bots (id, user_id, name, app_id, client_secret_cipher, environment, intents, status, created_at, updated_at) VALUES (?, ?, 'Target Bot', ?, ?, 'sandbox', 0, 'offline', ?, ?)`)
      .run(botId, user.id, `target-app-${botId}`, cryptoModule.encryptSecret("target-secret"), now, now);
    botServiceModule.recordEvent(botId, {
      type: "C2C_MESSAGE_CREATE",
      scene: "单聊",
      payload: { d: { id: "target-c2c-message", author: { user_openid: "target-c2c-openid" } } },
    });
    botServiceModule.recordEvent(botId, {
      type: "GROUP_AT_MESSAGE_CREATE",
      scene: "群聊",
      payload: { d: { id: "target-group-message", group_openid: "target-group-openid" } },
    });

    expect(botServiceModule.identifyBotTargetType(user, botId, "target-c2c-openid")).toBe("c2c");
    expect(botServiceModule.identifyBotTargetType(user, botId, "target-group-openid")).toBe("group");
    expect(botServiceModule.identifyBotTargetType(user, botId, "unknown-openid")).toBeNull();
    expect(botServiceModule.listBotMediaTargets(user, botId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetType: "group", targetOpenid: "target-group-openid" }),
      expect.objectContaining({ targetType: "c2c", targetOpenid: "target-c2c-openid" }),
    ]));
    const serverSideId = "server-side-id-is-not-an-openid";
    botServiceModule.recordEvent(botId, {
      type: "C2C_MESSAGE_CREATE",
      scene: "单聊",
      payload: { d: { id: "legacy-c2c-message", author: { id: serverSideId } } },
    });
    expect(botServiceModule.identifyBotTargetType(user, botId, serverSideId)).toBeNull();
  });
});
