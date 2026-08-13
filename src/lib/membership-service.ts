import "server-only";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getDatabase, writeAuditLog } from "@/lib/database";
import { getPaymentConfig, getPaymentPublicConfig } from "@/lib/system-settings-service";
import type { BillingCycle, MembershipOrder, MembershipPlan, MembershipPlanId, PaymentChannel, SessionUser } from "@/types/platform";

type MembershipPlanRow = {
  id: MembershipPlanId;
  name: string;
  bot_quota: number;
  plugin_quota: number;
  event_retention_days: number;
  description: string;
  monthly_price_cents: number;
  quarterly_price_cents: number;
  yearly_price_cents: number;
  features_json: string;
};

type OrderRow = {
  id: string;
  order_no: string;
  user_id: string;
  plan_id: MembershipPlanId;
  plan_name: string;
  billing_cycle: BillingCycle;
  payment_channel: PaymentChannel;
  amount_cents: number;
  provider: MembershipOrder["provider"];
  status: MembershipOrder["status"];
  payment_url: string | null;
  provider_trade_no: string | null;
  payment_note: string | null;
  created_at: string;
  paid_at: string | null;
  expires_at: string;
};

const cycleMonths: Record<BillingCycle, number> = { monthly: 1, quarterly: 3, yearly: 12 };

function parseFeatures(value: string) {
  try { return JSON.parse(value) as string[]; }
  catch { return []; }
}

function toPlan(row: MembershipPlanRow): MembershipPlan {
  return {
    id: row.id,
    name: row.name,
    botQuota: row.bot_quota,
    pluginQuota: row.plugin_quota,
    eventRetentionDays: row.event_retention_days,
    description: row.description,
    monthlyPriceCents: row.monthly_price_cents,
    quarterlyPriceCents: row.quarterly_price_cents,
    yearlyPriceCents: row.yearly_price_cents,
    features: parseFeatures(row.features_json),
  };
}

function toOrder(row: OrderRow): MembershipOrder {
  return {
    id: row.id,
    orderNo: row.order_no,
    planId: row.plan_id,
    planName: row.plan_name,
    billingCycle: row.billing_cycle,
    paymentChannel: row.payment_channel,
    amountCents: row.amount_cents,
    provider: row.provider,
    status: row.status,
    paymentUrl: row.payment_url,
    paymentNote: row.payment_note,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
}

function planRow(planId: MembershipPlanId) {
  return getDatabase().prepare(`
    SELECT id, name, bot_quota, plugin_quota, event_retention_days, description,
      monthly_price_cents, quarterly_price_cents, yearly_price_cents, features_json
    FROM membership_plans WHERE id = ? AND enabled = 1
  `).get(planId) as MembershipPlanRow | undefined;
}

function orderRow(orderId: string) {
  return getDatabase().prepare(`
    SELECT membership_orders.*, membership_plans.name AS plan_name
    FROM membership_orders JOIN membership_plans ON membership_plans.id = membership_orders.plan_id
    WHERE membership_orders.id = ?
  `).get(orderId) as OrderRow | undefined;
}

function orderAmount(plan: MembershipPlanRow, cycle: BillingCycle) {
  return cycle === "monthly" ? plan.monthly_price_cents : cycle === "quarterly" ? plan.quarterly_price_cents : plan.yearly_price_cents;
}

function addMonths(value: Date, months: number) {
  const next = new Date(value);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

function paymentType(channel: PaymentChannel) {
  if (channel === "alipay") return "alipay";
  if (channel === "wxpay") return "wxpay";
  if (channel === "qqpay") return "qqpay";
  return "alipay";
}

function epaySignature(params: Record<string, string>, key: string) {
  const canonical = Object.entries(params)
    .filter(([name, value]) => name !== "sign" && name !== "sign_type" && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  return createHash("md5").update(canonical + key).digest("hex");
}

export function listMembershipPlans() {
  const rows = getDatabase().prepare(`
    SELECT id, name, bot_quota, plugin_quota, event_retention_days, description,
      monthly_price_cents, quarterly_price_cents, yearly_price_cents, features_json
    FROM membership_plans WHERE enabled = 1 ORDER BY bot_quota ASC
  `).all() as MembershipPlanRow[];
  return rows.map(toPlan);
}

export function updateMembershipPlan(actor: SessionUser, planId: MembershipPlanId, input: Omit<MembershipPlan, "id">) {
  if (actor.role !== "admin") throw new Error("ADMIN_REQUIRED");
  if (planId === "free" && (input.monthlyPriceCents || input.quarterlyPriceCents || input.yearlyPriceCents)) throw new Error("FREE_PLAN_MUST_BE_FREE");
  const result = getDatabase().prepare(`
    UPDATE membership_plans SET name = ?, bot_quota = ?, plugin_quota = ?, event_retention_days = ?, description = ?,
      monthly_price_cents = ?, quarterly_price_cents = ?, yearly_price_cents = ?, features_json = ?, updated_at = ?
    WHERE id = ?
  `).run(input.name, input.botQuota, input.pluginQuota, input.eventRetentionDays, input.description,
    input.monthlyPriceCents, input.quarterlyPriceCents, input.yearlyPriceCents, JSON.stringify(input.features), new Date().toISOString(), planId);
  if (!result.changes) throw new Error("PLAN_NOT_FOUND");
  writeAuditLog(actor.id, "membership.plan.update", "membership_plan", planId, input);
  return toPlan(planRow(planId)!);
}

export function assignMembershipPlan(actor: SessionUser, userId: string, planId: MembershipPlanId) {
  if (actor.role !== "admin") throw new Error("ADMIN_REQUIRED");
  const plan = planRow(planId);
  if (!plan) throw new Error("PLAN_NOT_FOUND");
  const database = getDatabase();
  const target = database.prepare("SELECT id, bot_quota FROM users WHERE id = ?").get(userId) as { id: string; bot_quota: number } | undefined;
  if (!target) throw new Error("USER_NOT_FOUND");
  const usage = database.prepare("SELECT COUNT(*) AS count FROM bots WHERE user_id = ?").get(userId) as { count: number };
  const effectiveQuota = Math.max(usage.count, plan.bot_quota);
  const now = new Date().toISOString();
  database.transaction(() => {
    database.prepare(`
      INSERT INTO user_memberships (user_id, plan_id, status, starts_at, expires_at, assigned_by, updated_at)
      VALUES (?, ?, 'active', ?, NULL, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET plan_id = excluded.plan_id, status = 'active', starts_at = excluded.starts_at,
        expires_at = NULL, assigned_by = excluded.assigned_by, updated_at = excluded.updated_at
    `).run(userId, planId, now, actor.id, now);
    database.prepare("UPDATE users SET bot_quota = ? WHERE id = ?").run(effectiveQuota, userId);
    writeAuditLog(actor.id, "user.membership.update", "user", userId, { planId, previousBotQuota: target.bot_quota, botQuota: effectiveQuota });
  })();
  return { plan: toPlan(plan), botQuota: effectiveQuota };
}

export function membershipCenter(user: SessionUser) {
  const database = getDatabase();
  const membership = database.prepare(`
    SELECT user_memberships.plan_id, user_memberships.status, user_memberships.starts_at, user_memberships.expires_at,
      user_memberships.updated_at,
      membership_plans.name, membership_plans.bot_quota, membership_plans.plugin_quota, membership_plans.event_retention_days,
      membership_plans.description, membership_plans.monthly_price_cents, membership_plans.quarterly_price_cents,
      membership_plans.yearly_price_cents, membership_plans.features_json
    FROM user_memberships JOIN membership_plans ON membership_plans.id = user_memberships.plan_id
    WHERE user_memberships.user_id = ?
  `).get(user.id) as (MembershipPlanRow & { plan_id: MembershipPlanId; status: string; starts_at: string; expires_at: string | null; updated_at: string }) | undefined;
  const orders = database.prepare(`
    SELECT membership_orders.*, membership_plans.name AS plan_name
    FROM membership_orders JOIN membership_plans ON membership_plans.id = membership_orders.plan_id
    WHERE membership_orders.user_id = ? ORDER BY membership_orders.created_at DESC LIMIT 20
  `).all(user.id) as OrderRow[];
  const payment = getPaymentPublicConfig();
  const current = membership?.status === "active"
    ? { plan: toPlan({ ...membership, id: membership.plan_id }), status: membership.status, startsAt: membership.starts_at, expiresAt: membership.expires_at }
    : membership
      ? { plan: toPlan(planRow("free")!), status: membership.status, startsAt: membership.updated_at, expiresAt: null }
      : null;
  return {
    plans: listMembershipPlans(),
    current,
    orders: orders.map(toOrder),
    payment: { enabled: payment.enabled, provider: payment.provider, manualInstructions: payment.manualInstructions },
  };
}

export function createMembershipOrder(user: SessionUser, input: { planId: MembershipPlanId; billingCycle: BillingCycle; paymentChannel: PaymentChannel; returnUrl: string; notifyUrl: string }) {
  if (input.planId === "free") throw new Error("FREE_PLAN_ORDER_INVALID");
  const plan = planRow(input.planId);
  if (!plan) throw new Error("PLAN_NOT_FOUND");
  const amount = orderAmount(plan, input.billingCycle);
  if (amount <= 0) throw new Error("PLAN_PRICE_NOT_CONFIGURED");
  const payment = getPaymentConfig();
  if (!payment.enabled) throw new Error("PAYMENT_DISABLED");
  if (payment.provider === "sandbox" && process.env.NODE_ENV === "production") throw new Error("PAYMENT_SANDBOX_PRODUCTION_DISABLED");

  const id = randomUUID();
  const orderNo = `SB${Date.now()}${randomBytes(4).toString("hex").toUpperCase()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
  let paymentUrl: string | null = null;
  const note = payment.provider === "manual" ? payment.manualInstructions : null;
  let channel = input.paymentChannel;
  if (payment.provider === "manual") channel = "manual";
  if (payment.provider === "sandbox") channel = "sandbox";

  if (payment.provider === "epay") {
    const parameters: Record<string, string> = {
      pid: payment.epayPid,
      type: paymentType(channel),
      out_trade_no: orderNo,
      notify_url: input.notifyUrl,
      return_url: input.returnUrl,
      name: `${plan.name}-${input.billingCycle}`,
      money: (amount / 100).toFixed(2),
      sign_type: "MD5",
    };
    parameters.sign = epaySignature(parameters, payment.epayKey);
    const checkout = new URL(payment.epayGatewayUrl);
    for (const [key, value] of Object.entries(parameters)) checkout.searchParams.set(key, value);
    paymentUrl = checkout.toString();
  }

  getDatabase().prepare(`
    INSERT INTO membership_orders
      (id, order_no, user_id, plan_id, billing_cycle, payment_channel, amount_cents, provider, status, payment_url, payment_note, created_at, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
  `).run(id, orderNo, user.id, input.planId, input.billingCycle, channel, amount, payment.provider, paymentUrl, note, now.toISOString(), expiresAt.toISOString(), now.toISOString());
  writeAuditLog(user.id, "membership.order.create", "membership_order", id, { orderNo, planId: input.planId, billingCycle: input.billingCycle, amount });

  if (payment.provider === "sandbox") return confirmMembershipOrder(null, id, `sandbox-${orderNo}`, "开发环境沙箱支付自动完成");
  return { order: toOrder(orderRow(id)!), checkoutUrl: paymentUrl };
}

export function confirmMembershipOrder(actor: SessionUser | null, orderId: string, providerTradeNo: string, note = "") {
  const database = getDatabase();
  const row = orderRow(orderId);
  if (!row) throw new Error("ORDER_NOT_FOUND");
  if (actor && actor.role !== "admin") throw new Error("ADMIN_REQUIRED");
  if (row.status === "paid") return { order: toOrder(row), alreadyPaid: true };
  if (row.status !== "pending") throw new Error("ORDER_NOT_PAYABLE");
  const plan = planRow(row.plan_id);
  if (!plan) throw new Error("PLAN_NOT_FOUND");
  const now = new Date();
  const current = database.prepare("SELECT expires_at FROM user_memberships WHERE user_id = ? AND status = 'active'").get(row.user_id) as { expires_at: string | null } | undefined;
  const currentExpiry = current?.expires_at ? new Date(current.expires_at) : null;
  const startsFrom = currentExpiry && currentExpiry > now ? currentExpiry : now;
  const expiresAt = addMonths(startsFrom, cycleMonths[row.billing_cycle]);
  const usage = database.prepare("SELECT COUNT(*) AS count FROM bots WHERE user_id = ?").get(row.user_id) as { count: number };
  const effectiveQuota = Math.max(usage.count, plan.bot_quota);
  const paidAt = now.toISOString();

  database.transaction(() => {
    const result = database.prepare(`
      UPDATE membership_orders SET status = 'paid', provider_trade_no = ?, payment_note = ?, paid_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(providerTradeNo, note || row.payment_note, paidAt, paidAt, orderId);
    if (!result.changes) return;
    database.prepare(`
      INSERT INTO user_memberships (user_id, plan_id, status, starts_at, expires_at, assigned_by, updated_at)
      VALUES (?, ?, 'active', ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET plan_id = excluded.plan_id, status = 'active', starts_at = excluded.starts_at,
        expires_at = excluded.expires_at, assigned_by = excluded.assigned_by, updated_at = excluded.updated_at
    `).run(row.user_id, row.plan_id, paidAt, expiresAt.toISOString(), actor?.id || null, paidAt);
    database.prepare("UPDATE users SET bot_quota = ? WHERE id = ?").run(effectiveQuota, row.user_id);
    writeAuditLog(actor?.id || row.user_id, "membership.order.paid", "membership_order", orderId, { planId: row.plan_id, expiresAt: expiresAt.toISOString(), providerTradeNo });
  })();
  return { order: toOrder(orderRow(orderId)!), membership: { plan: toPlan(plan), expiresAt: expiresAt.toISOString(), botQuota: effectiveQuota }, alreadyPaid: false };
}

export function verifyEpayNotification(parameters: Record<string, string>) {
  const payment = getPaymentConfig();
  if (!payment.enabled || payment.provider !== "epay" || !payment.epayKey) throw new Error("PAYMENT_NOT_CONFIGURED");
  const expected = epaySignature(parameters, payment.epayKey);
  const received = parameters.sign || "";
  const valid = expected.length === received.length && timingSafeEqual(Buffer.from(expected), Buffer.from(received));
  if (!valid || parameters.trade_status !== "TRADE_SUCCESS") throw new Error("PAYMENT_SIGNATURE_INVALID");
  const order = getDatabase().prepare("SELECT id, amount_cents FROM membership_orders WHERE order_no = ?").get(parameters.out_trade_no) as { id: string; amount_cents: number } | undefined;
  if (!order || (order.amount_cents / 100).toFixed(2) !== Number(parameters.money).toFixed(2)) throw new Error("PAYMENT_ORDER_INVALID");
  return confirmMembershipOrder(null, order.id, parameters.trade_no || parameters.out_trade_no, "易支付异步通知");
}

export function listMembershipOrders(actor: SessionUser) {
  if (actor.role !== "admin") throw new Error("ADMIN_REQUIRED");
  const rows = getDatabase().prepare(`
    SELECT membership_orders.*, membership_plans.name AS plan_name
    FROM membership_orders JOIN membership_plans ON membership_plans.id = membership_orders.plan_id
    ORDER BY membership_orders.created_at DESC LIMIT 100
  `).all() as OrderRow[];
  return rows.map(toOrder);
}
