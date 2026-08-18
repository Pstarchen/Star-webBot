"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as Tabs from "@radix-ui/react-tabs";
import { Check, Clock3, CreditCard, Crown, LoaderCircle, ReceiptText, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { useTimeZone } from "@/components/time-zone-provider";
import { formatDateTime } from "@/lib/date-time";
import type { BillingCycle, MembershipOrder, MembershipPlan, PaymentChannel, PaymentProvider, SessionUser } from "@/types/platform";

type MembershipCenterData = {
  plans: MembershipPlan[];
  current: { plan: MembershipPlan; status: string; startsAt: string; expiresAt: string | null } | null;
  orders: MembershipOrder[];
  payment: { enabled: boolean; provider: PaymentProvider; manualInstructions: string };
};

class SessionExpiredError extends Error {}

async function fetchMembershipCenter(signal?: AbortSignal) {
  const response = await fetch("/api/membership", { cache: "no-store", credentials: "same-origin", signal });
  const body = await response.json().catch(() => ({})) as MembershipCenterData & { message?: string };
  if (response.status === 401) throw new SessionExpiredError("登录状态已失效");
  if (!response.ok) throw new Error(body.message || "会员中心加载失败");
  return body;
}

const cycleLabels: Record<BillingCycle, string> = { monthly: "月付", quarterly: "季付", yearly: "年付" };
const orderLabels: Record<MembershipOrder["status"], string> = { pending: "待支付", paid: "已支付", cancelled: "已取消", expired: "已过期", failed: "支付失败" };

function formatMoney(cents: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(cents / 100);
}

function formatDate(value: string | null, timeZone: string) {
  return value ? formatDateTime(value, timeZone, { dateStyle: "medium", timeStyle: "short" }) : "长期有效";
}

function cyclePrice(plan: MembershipPlan, cycle: BillingCycle) {
  return cycle === "monthly" ? plan.monthlyPriceCents : cycle === "quarterly" ? plan.quarterlyPriceCents : plan.yearlyPriceCents;
}

export function MembershipView({ user, onMembershipChange }: { user: SessionUser; onMembershipChange: (input: { plan: MembershipPlan; botQuota: number }) => void }) {
  const timeZone = useTimeZone();
  const router = useRouter();
  const [data, setData] = useState<MembershipCenterData | null>(null);
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [channel, setChannel] = useState<PaymentChannel>("alipay");
  const [busyPlan, setBusyPlan] = useState("");
  const [error, setError] = useState("");
  const paidPlans = useMemo(() => data?.plans.filter((plan) => plan.id !== "free") || [], [data]);

  async function load() {
    try {
      setData(await fetchMembershipCenter());
    } catch (loadError) {
      if (loadError instanceof SessionExpiredError) router.replace("/login?error=session_expired");
      throw loadError;
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    fetchMembershipCenter(controller.signal)
      .then(setData)
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        if (loadError instanceof SessionExpiredError) {
          router.replace("/login?error=session_expired");
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "会员中心加载失败");
      });
    return () => controller.abort();
  }, [router]);

  async function buy(plan: MembershipPlan) {
    setBusyPlan(plan.id);
    setError("");
    try {
      const response = await fetch("/api/membership/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id, billingCycle: cycle, paymentChannel: channel }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string; checkoutUrl?: string | null; membership?: { plan: MembershipPlan; botQuota: number } };
      if (!response.ok) throw new Error(body.message || "订单创建失败");
      if (body.checkoutUrl) {
        window.location.assign(body.checkoutUrl);
        return;
      }
      if (body.membership) onMembershipChange(body.membership);
      await load();
    } catch (purchaseError) {
      setError(purchaseError instanceof Error ? purchaseError.message : "订单创建失败");
    } finally {
      setBusyPlan("");
    }
  }

  if (!data) return error
    ? <div className="grid min-h-80 place-items-center"><div className="text-center"><div className="text-sm text-red-700">{error}</div><Button variant="outline" className="mt-4" onClick={() => { setError(""); void load().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "会员中心加载失败")); }}>重新加载</Button></div></div>
    : <div className="grid min-h-80 place-items-center text-sm text-muted-foreground"><LoaderCircle className="animate-spin" size={20} />正在加载会员中心</div>;
  const providerLabel = data.payment.provider === "epay" ? "在线支付" : data.payment.provider === "manual" ? "人工审核" : "开发沙箱";

  return (
    <div>
      <PageHeader title="会员与账单" description="按月、季度或年度开通会员，支付成功后额度和有效期立即更新。" action={<Badge variant={data.current?.status === "active" ? "success" : "outline"}>{data.current?.plan.name || user.membershipName}</Badge>} />
      {error && <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>}

      <Card className="mb-5 overflow-hidden">
        <CardContent className="grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="flex min-w-0 items-start gap-4">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-foreground text-background"><Crown size={19} /></div>
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold">当前为 {data.current?.plan.name || user.membershipName}</h2><Badge variant="outline">{providerLabel}</Badge></div><p className="mt-1.5 text-xs text-muted-foreground">有效期至 {formatDate(data.current?.expiresAt || null, timeZone)}</p></div>
          </div>
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border bg-border text-center text-xs">
            {[["机器人", data.current?.plan.botQuota], ["插件", data.current?.plan.pluginQuota], ["事件保留", `${data.current?.plan.eventRetentionDays || 7} 天`]].map(([label, value]) => <div key={String(label)} className="bg-card px-4 py-3"><div className="mono-data font-semibold">{value}</div><div className="mt-1 text-[10px] text-muted-foreground">{label}</div></div>)}
          </div>
        </CardContent>
      </Card>

      <div className="mb-5 flex flex-col justify-between gap-3 border-b pb-4 sm:flex-row sm:items-center">
        <Tabs.Root value={cycle} onValueChange={(value) => setCycle(value as BillingCycle)}>
          <Tabs.List className="inline-flex rounded-md bg-muted p-1" aria-label="会员付费周期">
            {(Object.keys(cycleLabels) as BillingCycle[]).map((value) => <Tabs.Trigger key={value} value={value} className="h-8 rounded-sm px-4 text-xs font-medium text-muted-foreground outline-none data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm">{cycleLabels[value]}</Tabs.Trigger>)}
          </Tabs.List>
        </Tabs.Root>
        {data.payment.provider === "epay" && <Select value={channel} onValueChange={(value) => setChannel(value as PaymentChannel)} options={[{ value: "alipay", label: "支付宝" }, { value: "wxpay", label: "微信支付" }, { value: "qqpay", label: "QQ 钱包" }]} ariaLabel="选择支付渠道" className="sm:w-36" />}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {paidPlans.map((plan) => {
          const price = cyclePrice(plan, cycle);
          const current = data.current?.plan.id === plan.id;
          return (
            <Card key={plan.id} className={current ? "border-foreground" : ""}>
              <CardHeader className="border-b">
                <div className="flex items-start justify-between gap-4"><div><CardTitle className="text-base">{plan.name}</CardTitle><CardDescription className="mt-2">{plan.description}</CardDescription></div>{current && <Badge variant="default">当前套餐</Badge>}</div>
                <div className="mt-4 flex items-baseline gap-1"><span className="text-3xl font-semibold">{formatMoney(price)}</span><span className="text-xs text-muted-foreground">/ {cycleLabels[cycle]}</span></div>
              </CardHeader>
              <CardContent className="pt-5">
                <div className="grid grid-cols-3 gap-2 border-b pb-5 text-center text-xs"><div><div className="mono-data font-semibold">{plan.botQuota}</div><div className="mt-1 text-[10px] text-muted-foreground">机器人</div></div><div><div className="mono-data font-semibold">{plan.pluginQuota}</div><div className="mt-1 text-[10px] text-muted-foreground">插件安装</div></div><div><div className="mono-data font-semibold">{plan.eventRetentionDays}</div><div className="mt-1 text-[10px] text-muted-foreground">保留天数</div></div></div>
                <div className="my-5 space-y-3">{plan.features.map((feature) => <div key={feature} className="flex items-center gap-2 text-xs"><Check size={14} className="text-emerald-600" />{feature}</div>)}</div>
                <Button className="w-full" disabled={!data.payment.enabled || !price || busyPlan === plan.id} onClick={() => void buy(plan)}><CreditCard size={15} />{busyPlan === plan.id ? "正在创建订单..." : data.payment.enabled ? `开通 ${cycleLabels[cycle]}` : "支付暂未开放"}</Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {data.payment.provider === "manual" && data.payment.manualInstructions && <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800"><ShieldCheck size={14} className="mr-2 inline" />{data.payment.manualInstructions}</div>}

      <Card className="mt-5 overflow-hidden">
        <CardHeader className="border-b"><CardTitle className="flex items-center gap-2"><ReceiptText size={15} />订单记录</CardTitle><CardDescription>展示最近 20 笔会员订单及支付状态。</CardDescription></CardHeader>
        {data.orders.length ? <div className="divide-y">{data.orders.map((order) => <div key={order.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_120px_100px] sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{order.planName} · {cycleLabels[order.billingCycle]}</span><Badge variant={order.status === "paid" ? "success" : order.status === "pending" ? "warning" : "outline"}>{orderLabels[order.status]}</Badge></div><div className="mono-data mt-1.5 text-[10px] text-muted-foreground">{order.orderNo}</div></div><div className="text-xs"><Clock3 size={12} className="mr-1.5 inline text-muted-foreground" />{formatDate(order.createdAt, timeZone)}</div><div className="mono-data text-sm font-semibold sm:text-right">{formatMoney(order.amountCents)}</div></div>)}</div> : <div className="p-8 text-center text-xs text-muted-foreground">暂无会员订单</div>}
      </Card>
    </div>
  );
}
