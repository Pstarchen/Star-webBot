import "server-only";
import { getDatabase, writeAuditLog } from "@/lib/database";
import { deleteSessionsForUser } from "@/lib/session";
import type { MembershipPlanId, SessionUser, TeamMember, UserRole } from "@/types/platform";

type UserListRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  bot_quota: number;
  status: "active" | "suspended";
  last_login_at: string | null;
  bot_count: number;
  membership_plan: MembershipPlanId;
  membership_name: string;
};

export function listTeamMembers(user: SessionUser) {
  const rows = getDatabase().prepare(`
    SELECT users.id, users.name, users.email, users.role, users.bot_quota, users.status, users.last_login_at,
      COALESCE(user_memberships.plan_id, 'free') AS membership_plan,
      COALESCE(membership_plans.name, '免费版') AS membership_name,
      COUNT(bots.id) AS bot_count
    FROM users
    LEFT JOIN bots ON bots.user_id = users.id
    LEFT JOIN user_memberships ON user_memberships.user_id = users.id AND user_memberships.status = 'active'
    LEFT JOIN membership_plans ON membership_plans.id = user_memberships.plan_id
    WHERE ? = 1 OR users.id = ?
    GROUP BY users.id
    ORDER BY users.created_at ASC
  `).all(user.role === "admin" ? 1 : 0, user.id) as UserListRow[];
  return rows.map((row): TeamMember => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    botQuota: row.bot_quota,
    botCount: row.bot_count,
    status: row.status === "active" ? "active" : "suspended",
    lastActive: row.last_login_at || "从未登录",
    membershipPlan: row.membership_plan,
    membershipName: row.membership_name,
  }));
}

export function updateUserQuota(actor: SessionUser, userId: string, botQuota: number) {
  if (actor.role !== "admin") throw new Error("ADMIN_REQUIRED");
  const target = getDatabase().prepare("SELECT id, bot_quota FROM users WHERE id = ?").get(userId) as { id: string; bot_quota: number } | undefined;
  if (!target) throw new Error("USER_NOT_FOUND");
  const usage = getDatabase().prepare("SELECT COUNT(*) AS count FROM bots WHERE user_id = ?").get(userId) as { count: number };
  if (botQuota < usage.count) throw new Error("QUOTA_BELOW_USAGE");
  getDatabase().prepare("UPDATE users SET bot_quota = ? WHERE id = ?").run(botQuota, userId);
  writeAuditLog(actor.id, "user.quota.update", "user", userId, { before: target.bot_quota, after: botQuota });
}

export function updateUserAccess(actor: SessionUser, userId: string, input: { role: UserRole; status: "active" | "suspended" }) {
  if (actor.role !== "admin") throw new Error("ADMIN_REQUIRED");
  if (actor.id === userId && (input.role !== "admin" || input.status !== "active")) throw new Error("SELF_ADMIN_PROTECTION");
  const database = getDatabase();
  const target = database.prepare("SELECT id, role, status FROM users WHERE id = ?").get(userId) as { id: string; role: UserRole; status: "active" | "suspended" } | undefined;
  if (!target) throw new Error("USER_NOT_FOUND");
  if (target.role === "admin" && input.role !== "admin") {
    const adminCount = database.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'").get() as { count: number };
    if (adminCount.count <= 1) throw new Error("LAST_ADMIN_PROTECTION");
  }

  database.transaction(() => {
    database.prepare("UPDATE users SET role = ?, status = ? WHERE id = ?").run(input.role, input.status, userId);
    if (input.status === "suspended") {
      database.prepare("UPDATE bots SET auto_connect = 0, updated_at = ? WHERE user_id = ?").run(new Date().toISOString(), userId);
      deleteSessionsForUser(userId);
    }
  })();
  writeAuditLog(actor.id, "user.access.update", "user", userId, { before: target, after: input });
  return { role: input.role, status: input.status };
}
