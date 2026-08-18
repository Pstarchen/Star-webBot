import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { getDatabase, writeAuditLog } from "@/lib/database";
import { hashPassword, verifyPassword } from "@/lib/password";
import type { MembershipPlanId, SessionUser, UserRole } from "@/types/platform";

const SESSION_COOKIE = "starbot_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

type UserRow = {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  bot_quota: number;
  status: "active" | "suspended";
  membership_plan: MembershipPlanId;
  membership_name: string;
};

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function toSessionUser(user: UserRow): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    botQuota: user.bot_quota,
    membershipPlan: user.membership_plan,
    membershipName: user.membership_name,
  };
}

const userWithMembershipSql = `
  SELECT users.*,
    COALESCE(user_memberships.plan_id, 'free') AS membership_plan,
    COALESCE(membership_plans.name, '免费版') AS membership_name
  FROM users
  LEFT JOIN user_memberships ON user_memberships.user_id = users.id AND user_memberships.status = 'active'
  LEFT JOIN membership_plans ON membership_plans.id = user_memberships.plan_id
`;

export function authenticate(email: string, password: string): SessionUser | null {
  const database = getDatabase();
  const user = database.prepare(userWithMembershipSql + " WHERE users.email = ?").get(email.trim().toLowerCase()) as UserRow | undefined;
  if (!user || user.status !== "active" || !verifyPassword(password, user.password_hash)) return null;
  database.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(new Date().toISOString(), user.id);
  writeAuditLog(user.id, "auth.login", "user", user.id);
  return toSessionUser(user);
}

export function authenticateWithEmail(email: string): SessionUser | null {
  const database = getDatabase();
  const user = database.prepare(userWithMembershipSql + " WHERE users.email = ?").get(email.trim().toLowerCase()) as UserRow | undefined;
  if (!user || user.status !== "active") return null;
  database.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(new Date().toISOString(), user.id);
  writeAuditLog(user.id, "auth.email.login", "user", user.id);
  return toSessionUser(user);
}

export function registerUser(input: { name: string; email: string; password: string }) {
  const database = getDatabase();
  const id = randomUUID();
  const email = input.email.trim().toLowerCase();
  const plan = database.prepare("SELECT bot_quota, name FROM membership_plans WHERE id = 'free'").get() as { bot_quota: number; name: string };
  const now = new Date().toISOString();
  database.transaction(() => {
    database.prepare(`
      INSERT INTO users (id, name, email, password_hash, role, bot_quota, status, created_at)
      VALUES (?, ?, ?, ?, 'developer', ?, 'active', ?)
    `).run(id, input.name.trim(), email, hashPassword(input.password), plan.bot_quota, now);
    database.prepare(`
      INSERT INTO user_memberships (user_id, plan_id, status, starts_at, expires_at, assigned_by, updated_at)
      VALUES (?, 'free', 'active', ?, NULL, NULL, ?)
    `).run(id, now, now);
  })();
  writeAuditLog(id, "auth.register", "user", id);
  return {
    id,
    name: input.name.trim(),
    email,
    role: "developer" as const,
    botQuota: plan.bot_quota,
    membershipPlan: "free" as const,
    membershipName: plan.name,
  };
}

export function createSessionToken(user: SessionUser) {
  const database = getDatabase();
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
  database.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(randomUUID(), user.id, tokenHash(token), expiresAt.toISOString(), now.toISOString());
  return token;
}

export function deleteSessionsForUser(userId: string) {
  getDatabase().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function getSessionUserById(userId: string): SessionUser | null {
  const user = getDatabase().prepare(userWithMembershipSql + " WHERE users.id = ? AND users.status = 'active'").get(userId) as UserRow | undefined;
  return user ? toSessionUser(user) : null;
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const database = getDatabase();
  database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
  const user = database.prepare(`
    SELECT users.*,
      COALESCE(user_memberships.plan_id, 'free') AS membership_plan,
      COALESCE(membership_plans.name, '免费版') AS membership_name
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    LEFT JOIN user_memberships ON user_memberships.user_id = users.id AND user_memberships.status = 'active'
    LEFT JOIN membership_plans ON membership_plans.id = user_memberships.plan_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.status = 'active'
  `).get(tokenHash(token), new Date().toISOString()) as UserRow | undefined;
  return user ? toSessionUser(user) : null;
}

export async function deleteCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) getDatabase().prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
}

export const sessionCookieName = SESSION_COOKIE;
export const sessionMaxAgeSeconds = SESSION_MAX_AGE_SECONDS;
