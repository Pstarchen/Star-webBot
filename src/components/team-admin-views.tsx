"use client";

import { useEffect, useMemo, useState } from "react";
import * as Progress from "@radix-ui/react-progress";
import { ArrowDownToLine, Bot as BotIcon, Crown, Minus, Plus, Search, ShieldCheck, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import type { MembershipPlan, MembershipPlanId, TeamMember, UserRole } from "@/types/platform";

const roleLabels: Record<UserRole, string> = {
  admin: "管理员",
  developer: "开发者",
  operator: "运营",
};

function MemberStatusBadge({ status }: { status: TeamMember["status"] }) {
  const values = {
    active: { label: "正常", variant: "success" as const },
    invited: { label: "待加入", variant: "warning" as const },
    suspended: { label: "已停用", variant: "destructive" as const },
  };
  return <Badge variant={values[status].variant}>{values[status].label}</Badge>;
}

export function TeamView({ members }: { members: TeamMember[] }) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | UserRole>("all");
  const filteredMembers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return members.filter((member) => {
      if (role !== "all" && member.role !== role) return false;
      if (!normalizedQuery) return true;
      return member.name.toLowerCase().includes(normalizedQuery) || member.email.toLowerCase().includes(normalizedQuery);
    });
  }, [members, query, role]);

  return (
    <div>
      <PageHeader title="团队成员" description="查看注册用户、角色、机器人配额和账号状态。" />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9 text-xs" placeholder="搜索姓名或邮箱" />
          </div>
          <Select value={role} onValueChange={(value) => setRole(value as "all" | UserRole)} options={[{ value: "all", label: "全部角色" }, { value: "admin", label: "管理员" }, { value: "developer", label: "开发者" }, { value: "operator", label: "运营" }]} ariaLabel="筛选成员角色" className="text-xs sm:w-40" />
        </div>

        {filteredMembers.length ? (
          <>
            <div className="divide-y md:hidden">
              {filteredMembers.map((member) => (
                <div key={member.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">{member.name.slice(0, 1)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{member.name}</span><MemberStatusBadge status={member.status} /></div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">{member.email}</div>
                    </div>
                  </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                      <div><div className="data-label">角色</div><div className="mt-1.5">{roleLabels[member.role]}</div></div>
                      <div><div className="data-label">会员</div><div className="mt-1.5">{member.membershipName}</div></div>
                      <div><div className="data-label">机器人</div><div className="mono-data mt-1.5">{member.botCount} / {member.botQuota}</div></div>
                    <div><div className="data-label">最近活动</div><div className="mt-1.5 truncate">{member.lastActive}</div></div>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="bg-muted/40 text-[10px] text-muted-foreground">
                  <tr><th className="px-5 py-3 font-medium">成员</th><th className="px-5 py-3 font-medium">角色</th><th className="px-5 py-3 font-medium">会员</th><th className="px-5 py-3 font-medium">机器人配额</th><th className="px-5 py-3 font-medium">状态</th><th className="px-5 py-3 font-medium">最近活动</th></tr>
                </thead>
                <tbody className="divide-y">
                  {filteredMembers.map((member) => (
                    <tr key={member.id} className="hover:bg-muted/30">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">{member.name.slice(0, 1)}</div>
                          <div className="min-w-0"><div className="font-medium">{member.name}</div><div className="mt-1 max-w-56 truncate text-[10px] text-muted-foreground">{member.email}</div></div>
                        </div>
                      </td>
                      <td className="px-5 py-4"><Badge variant="secondary">{roleLabels[member.role]}</Badge></td>
                      <td className="px-5 py-4"><Badge variant="outline">{member.membershipName}</Badge></td>
                      <td className="mono-data px-5 py-4">{member.botCount} / {member.botQuota}</td>
                      <td className="px-5 py-4"><MemberStatusBadge status={member.status} /></td>
                      <td className="px-5 py-4 text-muted-foreground">{member.lastActive}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <EmptyState icon={Users} title="没有符合条件的成员" />
        )}
      </Card>
    </div>
  );
}

export function AdminView({ currentUserId, initialMembers, onMembersChange }: { currentUserId: string; initialMembers: TeamMember[]; onMembersChange: (members: TeamMember[]) => void }) {
  const members = initialMembers;
  const [error, setError] = useState("");
  const [busyMemberId, setBusyMemberId] = useState("");
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const totalQuota = useMemo(() => members.reduce((sum, member) => sum + member.botQuota, 0), [members]);
  const totalBots = useMemo(() => members.reduce((sum, member) => sum + member.botCount, 0), [members]);
  const adminCount = useMemo(() => members.filter((member) => member.role === "admin").length, [members]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/membership-plans", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("会员套餐加载失败");
        return (await response.json()) as { plans: MembershipPlan[] };
      })
      .then((body) => setPlans(body.plans))
      .catch((loadError) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "会员套餐加载失败");
      });
    return () => controller.abort();
  }, []);

  async function changeMembership(memberId: string, planId: MembershipPlanId) {
    setBusyMemberId(memberId);
    setError("");
    try {
      const response = await fetch("/api/users/" + memberId + "/membership", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string; botQuota?: number; plan?: MembershipPlan };
      if (!response.ok || !body.plan || body.botQuota === undefined) throw new Error(body.message || "会员套餐更新失败");
      onMembersChange(members.map((member) => member.id === memberId ? {
        ...member,
        botQuota: body.botQuota!,
        membershipPlan: body.plan!.id,
        membershipName: body.plan!.name,
      } : member));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "会员套餐更新失败");
    } finally {
      setBusyMemberId("");
    }
  }

  async function changeAccess(memberId: string, input: { role?: UserRole; status?: "active" | "suspended" }) {
    const member = members.find((item) => item.id === memberId);
    if (!member) return;
    setBusyMemberId(memberId);
    setError("");
    try {
      const next = {
        role: input.role || member.role,
        status: input.status || (member.status === "suspended" ? "suspended" : "active"),
      };
      const response = await fetch("/api/users/" + memberId + "/access", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message || "账号权限更新失败");
      onMembersChange(members.map((item) => item.id === memberId ? { ...item, role: next.role, status: next.status } : item));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "账号权限更新失败");
    } finally {
      setBusyMemberId("");
    }
  }

  async function changeQuota(memberId: string, delta: number) {
    const member = members.find((item) => item.id === memberId);
    if (!member) return;
    const botQuota = Math.max(member.botCount, Math.min(999, member.botQuota + delta));
    if (botQuota === member.botQuota) return;

    setBusyMemberId(memberId);
    setError("");
    try {
      const response = await fetch("/api/users/" + memberId + "/quota", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botQuota }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message || "配额更新失败");
      onMembersChange(members.map((item) => item.id === memberId ? { ...item, botQuota } : item));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "配额更新失败");
    } finally {
      setBusyMemberId("");
    }
  }

  function exportQuotas() {
    const data = members.map(({ id, name, email, role, botCount, botQuota, status }) => ({ id, name, email, role, botCount, botQuota, status }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "starbot-user-quotas-" + new Date().toISOString().slice(0, 10) + ".json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader
        title="系统与配额"
        description="设置每位用户可添加的机器人数量，配额不能低于当前已用数量。"
        action={<Button variant="outline" onClick={exportQuotas}><ArrowDownToLine size={15} />导出配额</Button>}
      />

      {error && <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>}

      <section className="mb-5 grid gap-4 sm:grid-cols-3">
        {([
          [Users, "用户数量", members.length, "数据库用户"],
          [BotIcon, "已添加机器人", totalBots, "所有用户合计"],
          [ShieldCheck, "已分配配额", totalQuota, adminCount + " 位管理员"],
        ] as const).map(([Icon, label, value, detail]) => (
          <Card key={String(label)}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div><div className="text-xs text-muted-foreground">{label}</div><div className="mono-data mt-2 text-2xl font-semibold">{value}</div></div>
                <div className="grid h-9 w-9 place-items-center rounded-md bg-muted text-muted-foreground"><Icon size={17} /></div>
              </div>
              <div className="mt-4 text-[11px] text-muted-foreground">{detail}</div>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="mb-5 overflow-hidden">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2"><Crown size={15} />会员套餐</CardTitle>
          <CardDescription>套餐定义基础额度；管理员仍可在下方为单个用户覆盖机器人配额。</CardDescription>
        </CardHeader>
        <div className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {plans.map((plan) => (
            <div key={plan.id} className="p-5">
              <div className="text-sm font-semibold">{plan.name}</div>
              <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                <div className="flex justify-between"><span>机器人额度</span><span className="mono-data text-foreground">{plan.botQuota}</span></div>
                <div className="flex justify-between"><span>插件安装额度</span><span className="mono-data text-foreground">{plan.pluginQuota}</span></div>
                <div className="flex justify-between"><span>事件保留</span><span className="mono-data text-foreground">{plan.eventRetentionDays} 天</span></div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mb-5 overflow-hidden">
        <CardHeader className="border-b">
          <CardTitle>账号权限</CardTitle>
          <CardDescription>调整角色与账号状态；停用会立即失效该用户会话并断开其机器人。</CardDescription>
        </CardHeader>
        <div className="divide-y">
          {members.map((member) => {
            const busy = busyMemberId === member.id;
            const protectedAccount = member.id === currentUserId;
            return (
              <div key={member.id} className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(180px,1fr)_140px_140px] md:items-center">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{member.name}</span>{protectedAccount && <Badge variant="outline">当前账号</Badge>}</div>
                  <div className="mt-1 truncate text-[10px] text-muted-foreground">{member.email}</div>
                </div>
                <Select value={member.role} onValueChange={(value) => void changeAccess(member.id, { role: value as UserRole })} disabled={busy || protectedAccount} options={[{ value: "admin", label: "管理员" }, { value: "developer", label: "开发者" }, { value: "operator", label: "运营" }]} ariaLabel={member.name + "的角色"} className="text-xs" />
                <Select value={member.status === "suspended" ? "suspended" : "active"} onValueChange={(value) => void changeAccess(member.id, { status: value as "active" | "suspended" })} disabled={busy || protectedAccount} options={[{ value: "active", label: "正常" }, { value: "suspended", label: "停用" }]} ariaLabel={member.name + "的账号状态"} className="text-xs" />
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="border-b">
          <CardTitle>用户机器人配额</CardTitle>
          <CardDescription>变更会立即作用于服务端的新建机器人校验。</CardDescription>
        </CardHeader>
        {members.length ? (
          <div className="divide-y">
            {members.map((member) => {
              const usage = member.botQuota > 0 ? Math.min(100, Math.round((member.botCount / member.botQuota) * 100)) : member.botCount > 0 ? 100 : 0;
              const busy = busyMemberId === member.id;
              return (
                <div key={member.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(180px,1fr)_140px_minmax(150px,0.8fr)_150px] lg:items-center">
                  <div className="min-w-0"><div className="truncate text-sm font-medium">{member.name}</div><div className="mt-1 truncate text-[10px] text-muted-foreground">{member.email}</div></div>
                  <Select
                    value={member.membershipPlan}
                    onValueChange={(value) => void changeMembership(member.id, value as MembershipPlanId)}
                    disabled={busy || !plans.length}
                    options={plans.map((plan) => ({ value: plan.id, label: plan.name }))}
                    className="text-xs"
                    ariaLabel={member.name + "的会员套餐"}
                  />
                  <div>
                    <div className="mb-2 flex justify-between text-[10px]"><span className="text-muted-foreground">已使用</span><span className="mono-data">{member.botCount} / {member.botQuota}</span></div>
                    <Progress.Root value={usage} className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <Progress.Indicator className={usage >= 90 ? "h-full bg-warning transition-transform" : "h-full bg-foreground transition-transform"} style={{ transform: "translateX(-" + (100 - usage) + "%)" }} />
                    </Progress.Root>
                  </div>
                  <div className="flex items-center justify-start gap-2 md:justify-end">
                    <Button variant="outline" size="icon" className="h-8 w-8" disabled={busy || member.botQuota <= member.botCount} onClick={() => void changeQuota(member.id, -1)} aria-label="减少配额"><Minus size={13} /></Button>
                    <div className="mono-data grid h-8 w-12 place-items-center rounded-md border text-xs font-semibold">{member.botQuota}</div>
                    <Button variant="outline" size="icon" className="h-8 w-8" disabled={busy || member.botQuota >= 999} onClick={() => void changeQuota(member.id, 1)} aria-label="增加配额"><Plus size={13} /></Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={Users} title="暂无用户" />
        )}
      </Card>
    </div>
  );
}
