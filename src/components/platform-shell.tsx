"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Select from "@radix-ui/react-select";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  Activity,
  Blocks,
  Bot as BotIcon,
  Check,
  ChevronDown,
  Code2,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { AdminView, TeamView } from "@/components/team-admin-views";
import { BotsView } from "@/components/bots-view";
import { BrandMark } from "@/components/brand-mark";
import { DashboardOverview } from "@/components/dashboard-overview";
import { DeveloperView } from "@/components/developer-view";
import { EventsView } from "@/components/events-view";
import { PluginsView } from "@/components/plugins-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Bot, EventLog, Plugin, SessionUser, TeamMember } from "@/types/platform";

type ViewKey = "overview" | "bots" | "events" | "plugins" | "developer" | "team" | "admin";

type NavItem = {
  key: ViewKey;
  label: string;
  icon: React.ElementType;
};

const viewMeta: Record<ViewKey, { label: string; description: string }> = {
  overview: { label: "工作台总览", description: "跨机器人运行状态与实时业务指标" },
  bots: { label: "机器人实例", description: "管理应用凭据、连接和消息能力" },
  events: { label: "事件中心", description: "追踪 WebSocket、Webhook 与 API 请求链路" },
  plugins: { label: "SDK 应用", description: "创建扩展应用并管理事件消费" },
  developer: { label: "开发者中心", description: "SDK 接入、API 调试与开发工具" },
  team: { label: "团队成员", description: "角色、协作与访问控制" },
  admin: { label: "系统与配额", description: "用户机器人上限与安全策略" },
};

const workspaceNav: NavItem[] = [
  { key: "overview", label: "总览", icon: LayoutDashboard },
  { key: "bots", label: "机器人", icon: BotIcon },
  { key: "events", label: "事件中心", icon: Activity },
];

const buildNav: NavItem[] = [
  { key: "plugins", label: "SDK 应用", icon: Blocks },
  { key: "developer", label: "开发者中心", icon: Code2 },
];

function AddBotDialog({
  open,
  onOpenChange,
  used,
  quota,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  used: number;
  quota: number;
  onCreate: (input: {
    name: string;
    appId: string;
    clientSecret: string;
    environment: "production" | "sandbox";
    connectionMode: "websocket" | "webhook";
  }) => Promise<Bot>;
}) {
  const [name, setName] = useState("");
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [environment, setEnvironment] = useState<"production" | "sandbox">("sandbox");
  const [connectionMode, setConnectionMode] = useState<"websocket" | "webhook">("websocket");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const quotaReached = used >= quota;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (quotaReached || !name.trim() || !appId.trim() || !secret.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      await onCreate({
        name: name.trim(),
        appId: appId.trim(),
        clientSecret: secret,
        environment,
        connectionMode,
      });
      setName("");
      setAppId("");
      setSecret("");
      setEnvironment("sandbox");
      setConnectionMode("websocket");
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "机器人添加失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Dialog.Content className="modal-panel fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-32px)] w-[calc(100%-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-card p-5 shadow-2xl outline-none sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-semibold text-foreground">添加 QQ 机器人</Dialog.Title>
              <Dialog.Description className="mt-1.5 text-sm leading-6 text-muted-foreground">
                填写 QQ 开放平台的应用凭据，提交后由服务端验证并加密保存。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" className="-mr-2 -mt-2" aria-label="关闭">
                <X size={17} />
              </Button>
            </Dialog.Close>
          </div>

          <div className="mt-5 flex items-center justify-between border-y bg-muted/40 px-3 py-3">
            <div>
              <div className="text-xs font-medium text-foreground">机器人配额</div>
              <div className="mt-1 text-[11px] text-muted-foreground">管理员可在系统与配额中调整</div>
            </div>
            <Badge variant={quotaReached ? "warning" : "outline"} className="mono-data">
              {used} / {quota}
            </Badge>
          </div>

          {quotaReached ? (
            <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-800">
              机器人数量已达到上限，请联系管理员增加配额。
            </div>
          ) : (
            <form onSubmit={submit} className="mt-5 space-y-4">
              <label className="block">
                <span className="field-label">机器人名称</span>
                <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：星野助手" required />
              </label>
              <label className="block">
                <span className="field-label">AppID</span>
                <Input value={appId} onChange={(event) => setAppId(event.target.value)} className="mono-data text-xs" placeholder="QQ 开放平台 AppID" required />
              </label>
              <label className="block">
                <span className="field-label">Client Secret</span>
                <Input value={secret} onChange={(event) => setSecret(event.target.value)} className="mono-data text-xs" type="password" placeholder="仅在服务端处理" required />
              </label>
              <label className="block">
                <span className="field-label">使用阶段</span>
                <Select.Root value={environment} onValueChange={(value) => setEnvironment(value as "production" | "sandbox")}>
                  <Select.Trigger className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                    <Select.Value />
                    <Select.Icon><ChevronDown size={14} className="text-muted-foreground" /></Select.Icon>
                  </Select.Trigger>
                  <Select.Portal>
                    <Select.Content position="popper" sideOffset={6} className="z-[60] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg">
                      <Select.Viewport>
                        {([[
                          "sandbox",
                          "测试使用",
                        ], ["production", "正式使用"]] as const).map(([value, label]) => (
                          <Select.Item key={value} value={value} className="relative flex cursor-default select-none items-center rounded-sm px-2 py-2 pr-8 text-sm outline-none data-[highlighted]:bg-accent">
                            <Select.ItemText>{label}</Select.ItemText>
                            <Select.ItemIndicator className="absolute right-2"><Check size={14} /></Select.ItemIndicator>
                          </Select.Item>
                        ))}
                      </Select.Viewport>
                    </Select.Content>
                  </Select.Portal>
                </Select.Root>
                <span className="mt-1.5 block text-[11px] leading-5 text-muted-foreground">仅作为平台内标签，QQ OpenAPI 使用官方统一域名。Webhook 事件由 QQ 后台订阅；WebSocket 无需手填 Intents。</span>
              </label>
              <label className="block">
                <span className="field-label">事件接入方式</span>
                <Select.Root value={connectionMode} onValueChange={(value) => setConnectionMode(value as "websocket" | "webhook")}>
                  <Select.Trigger className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                    <Select.Value />
                    <Select.Icon><ChevronDown size={14} className="text-muted-foreground" /></Select.Icon>
                  </Select.Trigger>
                  <Select.Portal>
                    <Select.Content position="popper" sideOffset={6} className="z-[60] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg">
                      <Select.Viewport>
                        {([["websocket", "WebSocket · 平台托管"], ["webhook", "Webhook · QQ 官方推送"]] as const).map(([value, label]) => (
                          <Select.Item key={value} value={value} className="relative flex cursor-default select-none items-center rounded-sm px-2 py-2 pr-8 text-sm outline-none data-[highlighted]:bg-accent">
                            <Select.ItemText>{label}</Select.ItemText>
                            <Select.ItemIndicator className="absolute right-2"><Check size={14} /></Select.ItemIndicator>
                          </Select.Item>
                        ))}
                      </Select.Viewport>
                    </Select.Content>
                  </Select.Portal>
                </Select.Root>
              </label>
              {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
              <div className="flex justify-end gap-2 pt-1">
                <Dialog.Close asChild><Button variant="outline">取消</Button></Dialog.Close>
                <Button type="submit" disabled={submitting}>
                  <Plus size={15} />
                  {submitting ? "正在验证..." : "添加并验证"}
                </Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function PlatformShell({
  user,
  initialBots,
  initialEvents,
  initialPlugins,
  initialMembers,
}: {
  user: SessionUser;
  initialBots: Bot[];
  initialEvents: EventLog[];
  initialPlugins: Plugin[];
  initialMembers: TeamMember[];
}) {
  const router = useRouter();
  const [activeView, setActiveView] = useState<ViewKey>("overview");
  const [bots, setBots] = useState<Bot[]>(initialBots);
  const [events, setEvents] = useState<EventLog[]>(initialEvents);
  const [plugins, setPlugins] = useState<Plugin[]>(initialPlugins);
  const [members, setMembers] = useState<TeamMember[]>(initialMembers);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [addBotOpen, setAddBotOpen] = useState(false);
  const meta = viewMeta[activeView];
  const effectiveQuota = members.find((member) => member.id === user.id)?.botQuota ?? user.botQuota;
  const quotaUsage = effectiveQuota ? Math.min(100, (bots.length / effectiveQuota) * 100) : 100;

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const [botsResponse, eventsResponse, pluginsResponse, usersResponse] = await Promise.all([
        fetch("/api/bots", { cache: "no-store" }),
        fetch("/api/events?limit=100", { cache: "no-store" }),
        fetch("/api/plugins", { cache: "no-store" }),
        fetch("/api/users", { cache: "no-store" }),
      ]);
      if (cancelled) return;
      if (botsResponse.ok) setBots(((await botsResponse.json()) as { bots: Bot[] }).bots);
      if (eventsResponse.ok) setEvents(((await eventsResponse.json()) as { events: EventLog[] }).events);
      if (pluginsResponse.ok) setPlugins(((await pluginsResponse.json()) as { plugins: Plugin[] }).plugins);
      if (usersResponse.ok) setMembers(((await usersResponse.json()) as { users: TeamMember[] }).users);
    }

    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  function navigate(view: string) {
    setActiveView(view as ViewKey);
    setMobileOpen(false);
  }

  async function togglePlugin(id: string) {
    const plugin = plugins.find((item) => item.id === id);
    if (!plugin) return;
    const enabled = !plugin.enabled;
    const response = await fetch("/api/plugins/" + id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const body = await response.json().catch(() => ({})) as { message?: string };
    if (!response.ok) throw new Error(body.message || "SDK 应用状态更新失败");
    setPlugins((current) => current.map((item) => item.id === id ? { ...item, enabled } : item));
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  function renderNavItem(item: NavItem, compact = false) {
    const active = activeView === item.key;
    const itemButton = (
      <button
        key={item.key}
        onClick={() => navigate(item.key)}
        className={cn(
          "focus-ring group flex h-9 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium transition-colors",
          active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          compact && "justify-center px-0",
        )}
      >
        <item.icon size={16} />
        {!compact && <span className="truncate">{item.label}</span>}
      </button>
    );

    if (!compact) return itemButton;

    return (
      <Tooltip.Root key={item.key} delayDuration={150}>
        <Tooltip.Trigger asChild>{itemButton}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side="right" sideOffset={8} className="z-50 rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-lg">
            {item.label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    );
  }

  function renderSidebar(compact = false, mobile = false) {
    const adminNav: NavItem[] = [
      { key: "team", label: "团队成员", icon: Users },
      { key: "admin", label: "系统与配额", icon: ShieldCheck },
    ];

    const group = (label: string, items: NavItem[]) => (
      <div className="mb-6" key={label}>
        {!compact && <div className="mb-2 px-3 text-[11px] font-medium text-muted-foreground">{label}</div>}
        <div className="space-y-1">{items.map((item) => renderNavItem(item, compact))}</div>
      </div>
    );

    return (
      <>
        <div className={cn("flex h-14 items-center border-b", compact ? "justify-center px-2" : "justify-between px-4")}>
          <BrandMark compact={compact} />
          {mobile && (
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="关闭导航"><X size={18} /></Button>
            </Dialog.Close>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-5">
          {group("工作区", workspaceNav)}
          {group("开发", buildNav)}
          {user.role === "admin" && group("管理", adminNav)}
        </nav>
        <div className="border-t p-3">
          {compact ? (
            <Tooltip.Root delayDuration={150}>
              <Tooltip.Trigger asChild>
                <Button variant="ghost" size="icon" className="w-full" onClick={() => setAddBotOpen(true)} aria-label="添加机器人">
                  <Plus size={16} />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content side="right" sideOffset={8} className="z-50 rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-lg">
                  添加机器人
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          ) : (
            <div className="px-1 pb-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">机器人配额</span>
                <span className="mono-data font-medium text-foreground">{bots.length}/{effectiveQuota}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-foreground transition-[width]" style={{ width: quotaUsage + "%" }} />
              </div>
              <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => setAddBotOpen(true)}>
                <Plus size={14} />添加机器人
              </Button>
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <Tooltip.Provider>
      <div className="min-h-screen bg-background text-foreground">
        <aside className={cn("fixed inset-y-0 left-0 z-30 hidden flex-col border-r bg-card transition-[width] duration-200 lg:flex", sidebarCollapsed ? "w-16" : "w-60")}>
          {renderSidebar(sidebarCollapsed)}
          <Button
            variant="outline"
            size="icon"
            onClick={() => setSidebarCollapsed((value) => !value)}
            className="absolute -right-3 top-[68px] h-6 w-6 rounded-full bg-card"
            aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
          </Button>
        </aside>

        <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 lg:hidden" />
            <Dialog.Content className="mobile-drawer fixed inset-y-0 left-0 z-50 flex w-[min(288px,86vw)] flex-col border-r bg-card shadow-2xl outline-none lg:hidden">
              <Dialog.Title className="sr-only">主导航</Dialog.Title>
              <Dialog.Description className="sr-only">选择要打开的管理模块</Dialog.Description>
              {renderSidebar(false, true)}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <div className={cn("min-h-screen transition-[padding] duration-200", sidebarCollapsed ? "lg:pl-16" : "lg:pl-60")}>
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-card/95 px-4 backdrop-blur sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)} className="lg:hidden" aria-label="打开导航">
                <Menu size={19} />
              </Button>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{meta.label}</div>
                <div className="hidden truncate text-[11px] text-muted-foreground sm:block">{meta.description}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => setAddBotOpen(true)} className="hidden sm:inline-flex">
                <Plus size={14} />添加机器人
              </Button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button variant="outline" className="h-9 gap-2 px-2">
                    <span className="grid h-6 w-6 place-items-center rounded-md bg-primary text-[11px] font-semibold text-primary-foreground">
                      {user.name.slice(0, 1)}
                    </span>
                    <span className="hidden max-w-28 truncate text-xs sm:block">{user.name}</span>
                    <ChevronDown size={13} className="text-muted-foreground" />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg">
                    <div className="border-b px-2 py-2.5">
                      <div className="text-sm font-medium">{user.name}</div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">{user.email}</div>
                      <Badge variant="outline" className="mt-2">{user.membershipName}</Badge>
                    </div>
                    <DropdownMenu.Item onSelect={() => void logout()} className="mt-1 flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm text-red-600 outline-none data-[highlighted]:bg-red-50">
                      <LogOut size={15} />退出登录
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </header>

          <main className="mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-8">
            {activeView === "overview" && <DashboardOverview bots={bots} eventLogs={events} onAddBot={() => setAddBotOpen(true)} onNavigate={navigate} />}
            {activeView === "bots" && (
              <BotsView
                bots={bots}
                onAddBot={() => setAddBotOpen(true)}
                onRefresh={async () => {
                  const response = await fetch("/api/bots", { cache: "no-store" });
                  if (response.ok) setBots(((await response.json()) as { bots: Bot[] }).bots);
                }}
              />
            )}
            {activeView === "events" && (
              <EventsView
                events={events}
                onRefresh={async () => {
                  const response = await fetch("/api/events?limit=100", { cache: "no-store" });
                  if (!response.ok) throw new Error("事件刷新失败");
                  setEvents(((await response.json()) as { events: EventLog[] }).events);
                }}
              />
            )}
            {activeView === "plugins" && <PluginsView bots={bots} plugins={plugins} onToggle={togglePlugin} onCreated={(plugin) => setPlugins((current) => [plugin, ...current])} onDeleted={(pluginId) => setPlugins((current) => current.filter((plugin) => plugin.id !== pluginId))} />}
            {activeView === "developer" && <DeveloperView bots={bots} />}
            {activeView === "team" && <TeamView members={members} />}
            {activeView === "admin" && user.role === "admin" && <AdminView currentUserId={user.id} initialMembers={members} onMembersChange={setMembers} />}
          </main>
        </div>

        <AddBotDialog
          open={addBotOpen}
          onOpenChange={setAddBotOpen}
          used={bots.length}
          quota={effectiveQuota}
          onCreate={async (input) => {
            const response = await fetch("/api/bots", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(input),
            });
            const body = await response.json().catch(() => ({})) as { bot?: Bot; message?: string; traceId?: string };
            if (!response.ok || !body.bot) {
              throw new Error([body.message, body.traceId ? "Trace " + body.traceId : ""].filter(Boolean).join(" · ") || "机器人添加失败");
            }
            setBots((current) => [body.bot!, ...current]);
            setActiveView("bots");
            return body.bot;
          }}
        />
      </div>
    </Tooltip.Provider>
  );
}
