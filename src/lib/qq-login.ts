import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDatabase, writeAuditLog } from "@/lib/database";
import { hashPassword } from "@/lib/password";
import type { SessionUser } from "@/types/platform";

const QQ_AUTHORIZE_URL = "https://graph.qq.com/oauth2.0/authorize";
const QQ_TOKEN_URL = "https://graph.qq.com/oauth2.0/token";
const QQ_OPENID_URL = "https://graph.qq.com/oauth2.0/me";
const QQ_USER_INFO_URL = "https://graph.qq.com/user/get_user_info";
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

type QQProfile = {
  nickname?: string;
  figureurl_qq_1?: string;
  figureurl_qq_2?: string;
  ret?: number;
  msg?: string;
};

type OAuthUserRow = {
  id: string;
  name: string;
  email: string;
  role: SessionUser["role"];
  bot_quota: number;
  membership_plan: SessionUser["membershipPlan"];
  membership_name: string;
};

function stateHash(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

function config() {
  const appId = process.env.QQ_LOGIN_APP_ID;
  const appSecret = process.env.QQ_LOGIN_APP_SECRET;
  if (!appId || !appSecret) throw new Error("QQ_LOGIN_NOT_CONFIGURED");
  return { appId, appSecret };
}

function safeName(value: string | undefined) {
  const normalized = value?.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 40);
  return normalized && normalized.length >= 2 ? normalized : "QQ 用户";
}

function toSessionUser(row: OAuthUserRow): SessionUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    botQuota: row.bot_quota,
    membershipPlan: row.membership_plan,
    membershipName: row.membership_name,
  };
}

export function qqLoginEnabled() {
  return Boolean(process.env.QQ_LOGIN_APP_ID && process.env.QQ_LOGIN_APP_SECRET);
}

export function createQQAuthorization(redirectUri: string) {
  const { appId } = config();
  const state = randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  const database = getDatabase();
  database.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").run(Date.now());
  database.prepare(`
    INSERT INTO oauth_states (state_hash, provider, redirect_uri, expires_at, created_at)
    VALUES (?, 'qq', ?, ?, ?)
  `).run(stateHash(state), redirectUri, Date.now() + OAUTH_STATE_MAX_AGE_MS, now);

  const url = new URL(QQ_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "get_user_info");
  return { state, url };
}

function consumeQQState(state: string, redirectUri: string) {
  const database = getDatabase();
  const result = database.prepare(`
    DELETE FROM oauth_states
    WHERE state_hash = ? AND provider = 'qq' AND redirect_uri = ? AND expires_at > ?
  `).run(stateHash(state), redirectUri, Date.now());
  return result.changes === 1;
}

async function fetchJsonOrParams(url: URL) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  if (!response.ok) throw new Error("QQ_OAUTH_REQUEST_FAILED");
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const callbackMatch = text.match(/callback\s*\(\s*(\{[\s\S]*\})\s*\)\s*;?/i);
    if (callbackMatch) return JSON.parse(callbackMatch[1]) as Record<string, unknown>;
    return Object.fromEntries(new URLSearchParams(text));
  }
}

export async function completeQQLogin(code: string, state: string, cookieState: string, redirectUri: string) {
  if (!state || state !== cookieState || !consumeQQState(state, redirectUri)) throw new Error("QQ_OAUTH_STATE_INVALID");
  const { appId, appSecret } = config();

  const tokenUrl = new URL(QQ_TOKEN_URL);
  tokenUrl.searchParams.set("grant_type", "authorization_code");
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("code", code);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("fmt", "json");
  const tokenBody = await fetchJsonOrParams(tokenUrl);
  const accessToken = typeof tokenBody.access_token === "string" ? tokenBody.access_token : "";
  if (!accessToken) throw new Error("QQ_OAUTH_TOKEN_INVALID");

  const openIdUrl = new URL(QQ_OPENID_URL);
  openIdUrl.searchParams.set("access_token", accessToken);
  openIdUrl.searchParams.set("fmt", "json");
  const openIdBody = await fetchJsonOrParams(openIdUrl);
  const openId = typeof openIdBody.openid === "string" ? openIdBody.openid : "";
  if (!openId) throw new Error("QQ_OAUTH_OPENID_INVALID");

  const profileUrl = new URL(QQ_USER_INFO_URL);
  profileUrl.searchParams.set("access_token", accessToken);
  profileUrl.searchParams.set("oauth_consumer_key", appId);
  profileUrl.searchParams.set("openid", openId);
  profileUrl.searchParams.set("fmt", "json");
  const profile = await fetchJsonOrParams(profileUrl) as QQProfile;
  if (profile.ret !== undefined && profile.ret !== 0) throw new Error("QQ_OAUTH_PROFILE_INVALID");

  const database = getDatabase();
  const now = new Date().toISOString();
  const existing = database.prepare(`
    SELECT users.id, users.name, users.email, users.role, users.bot_quota,
      COALESCE(user_memberships.plan_id, 'free') AS membership_plan,
      COALESCE(membership_plans.name, '免费版') AS membership_name
    FROM oauth_accounts
    JOIN users ON users.id = oauth_accounts.user_id
    LEFT JOIN user_memberships ON user_memberships.user_id = users.id AND user_memberships.status = 'active'
    LEFT JOIN membership_plans ON membership_plans.id = user_memberships.plan_id
    WHERE oauth_accounts.provider = 'qq' AND oauth_accounts.provider_account_id = ? AND users.status = 'active'
  `).get(openId) as OAuthUserRow | undefined;

  if (existing) {
    database.prepare("UPDATE oauth_accounts SET profile_json = ?, updated_at = ? WHERE provider = 'qq' AND provider_account_id = ?").run(JSON.stringify(profile), now, openId);
    database.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now, existing.id);
    writeAuditLog(existing.id, "auth.qq.login", "user", existing.id);
    return toSessionUser(existing);
  }

  const plan = database.prepare("SELECT name, bot_quota FROM membership_plans WHERE id = 'free'").get() as { name: string; bot_quota: number };
  const userId = randomUUID();
  const email = `qq_${createHash("sha256").update(openId).digest("hex").slice(0, 24)}@oauth.local`;
  database.transaction(() => {
    database.prepare(`
      INSERT INTO users (id, name, email, password_hash, role, bot_quota, status, created_at, last_login_at)
      VALUES (?, ?, ?, ?, 'developer', ?, 'active', ?, ?)
    `).run(userId, safeName(profile.nickname), email, hashPassword(randomBytes(48).toString("base64url")), plan.bot_quota, now, now);
    database.prepare(`
      INSERT INTO user_memberships (user_id, plan_id, status, starts_at, expires_at, assigned_by, updated_at)
      VALUES (?, 'free', 'active', ?, NULL, NULL, ?)
    `).run(userId, now, now);
    database.prepare(`
      INSERT INTO oauth_accounts (provider, provider_account_id, user_id, profile_json, created_at, updated_at)
      VALUES ('qq', ?, ?, ?, ?, ?)
    `).run(openId, userId, JSON.stringify(profile), now, now);
    writeAuditLog(userId, "auth.qq.register", "user", userId);
  })();

  return {
    id: userId,
    name: safeName(profile.nickname),
    email,
    role: "developer",
    botQuota: plan.bot_quota,
    membershipPlan: "free",
    membershipName: plan.name,
  } satisfies SessionUser;
}
