import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "starbot-qq-login-test-"));
const databasePath = path.join(temporaryDirectory, "starbot.db");
const redirectUri = "http://localhost:3000/api/auth/qq/callback";

let databaseModule: typeof import("@/lib/database");
let qqLoginModule: typeof import("@/lib/qq-login");
let callbackRoute: typeof import("@/app/api/auth/qq/callback/route");
let sessionModule: typeof import("@/lib/session");
let systemSettingsModule: typeof import("@/lib/system-settings-service");

type QQResponseSet = {
  token?: Response;
  openId?: Response;
  profile?: Response;
};

function mockQQResponses(responses: QQResponseSet = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.pathname === "/oauth2.0/token") {
      expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
      return responses.token || Response.json({ access_token: "access-token", expires_in: 7776000 });
    }
    if (url.pathname === "/oauth2.0/me") {
      return responses.openId || new Response('callback( {"client_id":"qq-login-app","openid":"openid-1"} );');
    }
    if (url.pathname === "/user/get_user_info") {
      return responses.profile || Response.json({ ret: 0, nickname: "QQ 开发者" });
    }
    throw new Error(`Unexpected QQ OAuth URL: ${url}`);
  });
}

function setCookies(response: Response) {
  return typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
}

beforeAll(async () => {
  process.env.DATABASE_PATH = databasePath;
  process.env.BOOTSTRAP_ADMIN_EMAIL = "admin@qq-login.test";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "admin-password-2026";
  process.env.QQ_LOGIN_APP_ID = "qq-login-app";
  process.env.QQ_LOGIN_APP_SECRET = "qq-login-secret";
  process.env.QQ_LOGIN_REDIRECT_URI = redirectUri;
  [databaseModule, qqLoginModule, callbackRoute, sessionModule, systemSettingsModule] = await Promise.all([
    import("@/lib/database"),
    import("@/lib/qq-login"),
    import("@/app/api/auth/qq/callback/route"),
    import("@/lib/session"),
    import("@/lib/system-settings-service"),
  ]);
  databaseModule.getDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  const state = globalThis as typeof globalThis & { __starbotDatabase?: { close(): void } };
  state.__starbotDatabase?.close();
  delete state.__starbotDatabase;
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("QQ OAuth", () => {
  it("uses environment fallback until an administrator saves database configuration", () => {
    expect(systemSettingsModule.getQQLoginConfig()).toEqual({
      enabled: true,
      appId: "qq-login-app",
      appSecret: "qq-login-secret",
      redirectUri,
    });
    const admin = sessionModule.authenticate("admin@qq-login.test", "admin-password-2026");
    expect(admin).not.toBeNull();
    try {
      systemSettingsModule.updateQQLoginSettings(admin!, {
        enabled: true,
        appId: "database-qq-app",
        appSecret: "database-qq-secret",
        redirectUri: "https://console.example.com/api/auth/qq/callback",
      });
      expect(systemSettingsModule.getQQLoginConfig()).toEqual({
        enabled: true,
        appId: "database-qq-app",
        appSecret: "database-qq-secret",
        redirectUri: "https://console.example.com/api/auth/qq/callback",
      });
    } finally {
      databaseModule.getDatabase().prepare(`
        UPDATE system_settings SET qq_login_enabled = 0, qq_app_id = '', qq_app_secret_cipher = NULL, qq_redirect_uri = '' WHERE id = 1
      `).run();
    }
  });

  it("binds authorization state to the redirect URI and consumes it once", async () => {
    const authorization = qqLoginModule.createQQAuthorization(redirectUri);
    expect(authorization.url.origin + authorization.url.pathname).toBe("https://graph.qq.com/oauth2.0/authorize");
    expect(authorization.url.searchParams.get("client_id")).toBe("qq-login-app");
    expect(authorization.url.searchParams.get("redirect_uri")).toBe(redirectUri);

    await expect(qqLoginModule.completeQQLogin("code", authorization.state, authorization.state, "https://other.example/callback"))
      .rejects.toThrow("QQ_OAUTH_STATE_INVALID");

    mockQQResponses();
    const user = await qqLoginModule.completeQQLogin("code", authorization.state, authorization.state, redirectUri);
    expect(user).toMatchObject({ name: "QQ 开发者", role: "developer", membershipPlan: "free", botQuota: 1 });
    await expect(qqLoginModule.completeQQLogin("code", authorization.state, authorization.state, redirectUri))
      .rejects.toThrow("QQ_OAUTH_STATE_INVALID");
  });

  it("reuses an existing QQ account without creating another user", async () => {
    const firstUser = databaseModule.getDatabase().prepare("SELECT user_id FROM oauth_accounts WHERE provider = 'qq' AND provider_account_id = 'openid-1'").get() as { user_id: string };
    const authorization = qqLoginModule.createQQAuthorization(redirectUri);
    mockQQResponses({ profile: Response.json({ ret: 0, nickname: "新的 QQ 昵称" }) });

    const user = await qqLoginModule.completeQQLogin("new-code", authorization.state, authorization.state, redirectUri);
    expect(user.id).toBe(firstUser.user_id);
    expect((databaseModule.getDatabase().prepare("SELECT COUNT(*) AS count FROM oauth_accounts WHERE provider = 'qq' AND provider_account_id = 'openid-1'").get() as { count: number }).count).toBe(1);
  });

  it.each([
    ["token", { token: Response.json({ error: 100001 }) }, "QQ_OAUTH_TOKEN_INVALID"],
    ["OpenID", { openId: new Response("callback({});") }, "QQ_OAUTH_OPENID_INVALID"],
    ["profile", { profile: Response.json({ ret: 100030, msg: "invalid openid" }) }, "QQ_OAUTH_PROFILE_INVALID"],
    ["HTTP", { token: new Response("upstream failed", { status: 502 }) }, "QQ_OAUTH_REQUEST_FAILED"],
  ])("rejects malformed %s responses", async (_name, responses, expectedError) => {
    const authorization = qqLoginModule.createQQAuthorization(redirectUri);
    mockQQResponses(responses);
    await expect(qqLoginModule.completeQQLogin("code", authorization.state, authorization.state, redirectUri))
      .rejects.toThrow(expectedError);
  });

  it("creates a session and clears OAuth state after a successful callback", async () => {
    const authorization = qqLoginModule.createQQAuthorization(redirectUri);
    mockQQResponses({ openId: new Response('callback({"openid":"openid-callback"});') });
    const request = new NextRequest(`${redirectUri}?code=callback-code&state=${authorization.state}`, {
      headers: { Cookie: `starbot_qq_oauth_state=${authorization.state}` },
    });

    const response = await callbackRoute.GET(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/console");
    expect(setCookies(response).some((value) => value.startsWith("starbot_session=") && value.includes("HttpOnly"))).toBe(true);
    expect(setCookies(response).some((value) => value.startsWith("starbot_qq_oauth_state=") && value.includes("Max-Age=0"))).toBe(true);
  });

  it("clears OAuth state when callback parameters are invalid", async () => {
    const response = await callbackRoute.GET(new NextRequest(`${redirectUri}?state=incomplete`, {
      headers: { Cookie: "starbot_qq_oauth_state=incomplete" },
    }));
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?error=qq_callback_invalid");
    expect(setCookies(response).some((value) => value.startsWith("starbot_qq_oauth_state=") && value.includes("Max-Age=0"))).toBe(true);
  });
});
