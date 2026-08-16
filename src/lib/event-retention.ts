import "server-only";
import { getDatabase, writeAuditLog } from "@/lib/database";

export function pruneExpiredEvents() {
  const database = getDatabase();
  const candidates = database.prepare(`
    SELECT users.id AS user_id,
      COALESCE(membership_plans.event_retention_days, 7) AS retention_days
    FROM users
    LEFT JOIN user_memberships ON user_memberships.user_id = users.id AND user_memberships.status = 'active'
    LEFT JOIN membership_plans ON membership_plans.id = user_memberships.plan_id
  `).all() as Array<{ user_id: string; retention_days: number }>;

  let deleted = 0;
  const remove = database.prepare(`
    DELETE FROM event_logs
    WHERE bot_id IN (SELECT id FROM bots WHERE user_id = ?)
      AND received_at < ?
  `);
  database.transaction(() => {
    for (const candidate of candidates) {
      const expiresBefore = new Date(Date.now() - candidate.retention_days * 24 * 60 * 60 * 1000).toISOString();
      const result = remove.run(candidate.user_id, expiresBefore);
      deleted += result.changes;
    }
  })();
  if (deleted > 0) writeAuditLog(null, "events.retention.prune", "event_log", null, { deleted });
  return deleted;
}
