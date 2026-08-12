import "server-only";
import { getDatabase, writeAuditLog } from "@/lib/database";
import type { MembershipPlan, MembershipPlanId, SessionUser } from "@/types/platform";

type MembershipPlanRow = {
  id: MembershipPlanId;
  name: string;
  bot_quota: number;
  plugin_quota: number;
  event_retention_days: number;
};

function toPlan(row: MembershipPlanRow): MembershipPlan {
  return {
    id: row.id,
    name: row.name,
    botQuota: row.bot_quota,
    pluginQuota: row.plugin_quota,
    eventRetentionDays: row.event_retention_days,
  };
}

export function listMembershipPlans() {
  const rows = getDatabase().prepare(`
    SELECT id, name, bot_quota, plugin_quota, event_retention_days
    FROM membership_plans WHERE enabled = 1 ORDER BY bot_quota ASC
  `).all() as MembershipPlanRow[];
  return rows.map(toPlan);
}

export function assignMembershipPlan(actor: SessionUser, userId: string, planId: MembershipPlanId) {
  if (actor.role !== "admin") throw new Error("ADMIN_REQUIRED");
  const database = getDatabase();
  const plan = database.prepare(`
    SELECT id, name, bot_quota, plugin_quota, event_retention_days
    FROM membership_plans WHERE id = ? AND enabled = 1
  `).get(planId) as MembershipPlanRow | undefined;
  if (!plan) throw new Error("PLAN_NOT_FOUND");

  const target = database.prepare("SELECT id, bot_quota FROM users WHERE id = ?").get(userId) as { id: string; bot_quota: number } | undefined;
  if (!target) throw new Error("USER_NOT_FOUND");
  const usage = database.prepare("SELECT COUNT(*) AS count FROM bots WHERE user_id = ?").get(userId) as { count: number };
  const effectiveQuota = Math.max(usage.count, plan.bot_quota);
  const now = new Date().toISOString();

  database.transaction(() => {
    database.prepare(`
      INSERT INTO user_memberships (user_id, plan_id, status, starts_at, expires_at, assigned_by, updated_at)
      VALUES (?, ?, 'active', ?, NULL, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        plan_id = excluded.plan_id,
        status = 'active',
        starts_at = excluded.starts_at,
        expires_at = NULL,
        assigned_by = excluded.assigned_by,
        updated_at = excluded.updated_at
    `).run(userId, planId, now, actor.id, now);
    database.prepare("UPDATE users SET bot_quota = ? WHERE id = ?").run(effectiveQuota, userId);
    writeAuditLog(actor.id, "user.membership.update", "user", userId, {
      planId,
      previousBotQuota: target.bot_quota,
      botQuota: effectiveQuota,
    });
  })();

  return { plan: toPlan(plan), botQuota: effectiveQuota };
}
