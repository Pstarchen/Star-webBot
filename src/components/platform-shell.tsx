"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
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
  CreditCard,
  LayoutDashboard,
  KeyRound,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  QrCode,
  Settings2,
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
import { MembershipView } from "@/components/membership-view";
import { PluginsView } from "@/components/plugins-view";
import { SiteFooter } from "@/components/site-footer";
import { SystemSettingsView } from "@/components/system-settings-view";
import { TimeZoneProvider } from "@/components/time-zone-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Bot, EventLog, PluginCenterData, SessionUser, SitePublicSettings, TeamMember } from "@/types/platform";

type ViewKey = "overview" | "bots" | "events" | "plugins" | "developer" | "membership" | "team" | "admin" | "auth" | "settings";

type NavItem = {
  key: ViewKey;
  label: string;
  icon: React.ElementType;
};

const viewMeta: Record<ViewKey, { label: string; description: string }> = {
  overview: { label: "工作台总览", description: "跨机器人运行状态与实时业务指标" },
  bots: { label: "机器人实例", description: "管理应用凭据、连接和消息能力" },
  events: { label: "事件中心", description: "追踪 WebSocket、Webhook 与 API 请求链路" },
  plugins: { label: "插件中心", description: "市场发现、插件安装与机器人运行配置" },
  developer: { label: "开发者中心", description: "插件 SDK、QQ OpenAPI 调试与开发工具" },
  membership: { label: "会员与账单", description: "购买会员套餐、查看权益有效期和支付订单" },
  team: { label: "团队成员", description: "角色、协作与访问控制" },
  admin: { label: "用户设置", description: "用户会员、配额、角色与账号状态" },
  auth: { label: "登录与注册", description: "邮箱验证、验证码登录与 QQ 互联" },
  settings: { label: "系统设置", description: "站点品牌、支付渠道与套餐定价" },
};

const workspaceNav: NavItem[] = [
  { key: "overview", label: "总览", icon: LayoutDashboard },
  { key: "bots", label: "机器人", icon: BotIcon },
  { key: "events", label: "事件中心", icon: Activity },
];

const buildNav: NavItem[] = [
  { key: "plugins", label: "插件中心", icon: Blocks },
  { key: "developer", label: "开发者中心", icon: Code2 },
];

function qrErrorMessage(code: string) {
  const messages: Record<string, string> = {
    BOT_QUOTA_EXCEEDED: "机器人数量已达到上限，请联系管理员增加配额。",
    BOT_DUPLICATE: "该 QQ 机器人已经添加。",
    QQ_BOT_PROFILE_INVALID: "QQ 未返回有效的机器人资料，请检查机器人权限。",
    QQ_BOT_QR_EXPIRED: "二维码已过期，请重新生成。",
    QQ_BOT_QR_CANCELLED: "扫码已取消。",
    QQ_BOT_QR_MULTIPLE_RESULTS: "本次扫码返回了多个机器人，请重新扫码并只选择一个。",
    QQ_BOT_QR_CREDENTIALS_INVALID: "QQ 扫码服务未返回有效凭据。",
    QQ_BOT_API_100007: "QQ 返回的机器人已失效或不存在，请在 QQ 开放平台确认机器人状态后重新扫码。",
    QQ_BOT_API_100016: "QQ 返回的机器人凭据无效，请确认扫码选择的是当前可用的 QQ 机器人。",
    QQ_BOT_API_10004: "QQ 开放平台未找到该机器人，请确认机器人仍处于可用状态。",
    QQ_BOT_API_HTTP_401: "QQ 开放平台拒绝了机器人凭据，请重新扫码。",
    QQ_BOT_API_HTTP_404: "QQ 开放平台未找到该机器人，请确认机器人状态。",
    QQ_BOT_API_HTTP_429: "QQ 开放平台暂时限流，请稍后重新扫码。",
    QQ_BOT_API_HTTP_500: "QQ 开放平台暂时不可用，请稍后重新扫码。",
    QQ_BOT_API_HTTP_504: "QQ 开放平台响应超时，请稍后重新扫码。",
  };
  return messages[code] || "扫码绑定失败，请稍后重试。";
}

function AddBotDialog({
  open,
  onOpenChange,
  used,
  quota,
  onCreate,
  onQrCompleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  used: number;
  quota: number;
  onCreate: (input: {
    appId: string;
    clientSecret: string;
    environment: "production" | "sandbox";
    connectionMode: "websocket" | "webhook";
  }) => Promise<Bot>;
  onQrCompleted: () => Promise<void>;
}) {
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [environment, setEnvironment] = useState<"production" | "sandbox">("sandbox");
  const [connectionMode, setConnectionMode] = useState<"websocket" | "webhook">("websocket");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"manual" | "qr">("qr");
  const [qrSessionId, setQrSessionId] = useState("");
  const [qrStatus, setQrStatus] = useState<"pending" | "scanning" | "completed" | "expired" | "cancelled" | "failed">("pending");
  const [qrRevision, setQrRevision] = useState(0);
  const [qrError, setQrError] = useState("");
  const [qrStarting, setQrStarting] = useState(false);
  const quotaReached = used >= quota;

  const resetQr = useCallback(() => {
    setQrSessionId("");
    setQrStatus("pending");
    setQrRevision(0);
    setQrError("");
  }, []);

  const closeDialog = useCallback((nextOpen: boolean) => {
    if (!nextOpen && qrSessionId && (qrStatus === "pending" || qrStatus === "scanning")) {
      void fetch(`/api/bot-qr-sessions/${qrSessionId}/cancel`, { method: "POST" });
    }
    if (!nextOpen) {
      resetQr();
      setMode("qr");
      setError("");
    }
    onOpenChange(nextOpen);
  }, [onOpenChange, qrSessionId, qrStatus, resetQr]);

  async function startQr() {
    if (quotaReached) return;
    setQrStarting(true);
    setQrError("");
    try {
      const response = await fetch("/api/bot-qr-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environment, connectionMode }),
      });
      const body = await response.json().catch(() => ({})) as { session?: { id: string; status: typeof qrStatus; qrRevision: number }; message?: string };
      if (!response.ok || !body.session) throw new Error(body.message || "扫码会话创建失败");
      setQrSessionId(body.session.id);
      setQrStatus(body.session.status);
      setQrRevision(body.session.qrRevision);
    } catch (startError) {
      setQrError(startError instanceof Error ? startError.message : "扫码会话创建失败");
    } finally {
      setQrStarting(false);
    }
  }

  async function cancelQr() {
    if (!qrSessionId) return;
    await fetch(`/api/bot-qr-sessions/${qrSessionId}/cancel`, { method: "POST" }).catch(() => undefined);
    setQrStatus("cancelled");
  }

  function switchMode(nextMode: "manual" | "qr") {
    if (nextMode === "manual" && qrSessionId && (qrStatus === "pending" || qrStatus === "scanning")) void cancelQr();
    setMode(nextMode);
  }

  useEffect(() => {
    if (!qrSessionId || ["completed", "expired", "cancelled", "failed"].includes(qrStatus)) return;
    let stopped = false;
    async function poll() {
      try {
        const response = await fetch(`/api/bot-qr-sessions/${qrSessionId}`, { cache: "no-store" });
        const body = await response.json().catch(() => ({})) as { session?: { status: typeof qrStatus; qrRevision: number; botId?: string | null; errorCode?: string | null } };
        if (!response.ok || !body.session) throw new Error("扫码会话已失效");
        if (stopped) return;
        setQrStatus(body.session.status);
        setQrRevision(body.session.qrRevision);
        if (body.session.errorCode) setQrError(qrErrorMessage(body.session.errorCode));
        if (body.session.status === "completed") {
          await onQrCompleted();
          if (!stopped) closeDialog(false);
          return;
        }
        if (!stopped && !["expired", "cancelled", "failed"].includes(body.session.status)) window.setTimeout(() => void poll(), 1_500);
      } catch (pollError) {
        if (!stopped) setQrError(pollError instanceof Error ? pollError.message : "扫码状态查询失败");
      }
    }
    void poll();
    return () => { stopped = true; };
  }, [closeDialog, onQrCompleted, qrSessionId, qrStatus]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (quotaReached || !appId.trim() || !secret.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      await onCreate({
        appId: appId.trim(),
        clientSecret: secret,
        environment,
        connectionMode,
      });
      setAppId("");
      setSecret("");
      setEnvironment("sandbox");
      setConnectionMode("websocket");
      closeDialog(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "机器人添加失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={closeDialog}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Dialog.Content className="modal-panel fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-32px)] w-[calc(100%-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-card p-5 shadow-2xl outline-none sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-semibold text-foreground">添加 QQ 机器人</Dialog.Title>
              <Dialog.Description className="mt-1.5 text-sm leading-6 text-muted-foreground">
                可使用手机 QQ 扫码绑定，也可以填写 QQ 开放平台应用凭据。
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
              <div className="mt-1 text-[11px] text-muted-foreground">管理员可在用户设置中调整</div>
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
            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
                <Button type="button" size="sm" variant={mode === "qr" ? "default" : "ghost"} onClick={() => switchMode("qr")}><QrCode size={14} />扫码添加</Button>
                <Button type="button" size="sm" variant={mode === "manual" ? "default" : "ghost"} onClick={() => switchMode("manual")}><KeyRound size={14} />手动填写</Button>
              </div>
              {mode === "qr" ? (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="field-label">使用阶段</span>
                      <Select.Root value={environment} onValueChange={(value) => setEnvironment(value as "production" | "sandbox")}>
                        <Select.Trigger className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"><Select.Value /><Select.Icon><ChevronDown size={14} className="text-muted-foreground" /></Select.Icon></Select.Trigger>
                        <Select.Portal><Select.Content position="popper" sideOffset={6} className="z-[60] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"><Select.Viewport>{([["sandbox", "测试使用"], ["production", "正式使用"]] as const).map(([value, label]) => <Select.Item key={value} value={value} className="relative flex cursor-default select-none items-center rounded-sm px-2 py-2 pr-8 text-sm outline-none data-[highlighted]:bg-accent"><Select.ItemText>{label}</Select.ItemText><Select.ItemIndicator className="absolute right-2"><Check size={14} /></Select.ItemIndicator></Select.Item>)}</Select.Viewport></Select.Content></Select.Portal>
                      </Select.Root>
                    </label>
                    <label className="block">
                      <span className="field-label">事件接入方式</span>
                      <Select.Root value={connectionMode} onValueChange={(value) => setConnectionMode(value as "websocket" | "webhook")}>
                        <Select.Trigger className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"><Select.Value /><Select.Icon><ChevronDown size={14} className="text-muted-foreground" /></Select.Icon></Select.Trigger>
                        <Select.Portal><Select.Content position="popper" sideOffset={6} className="z-[60] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"><Select.Viewport>{([["websocket", "WebSocket · 平台托管"], ["webhook", "Webhook · QQ 官方推送"]] as const).map(([value, label]) => <Select.Item key={value} value={value} className="relative flex cursor-default select-none items-center rounded-sm px-2 py-2 pr-8 text-sm outline-none data-[highlighted]:bg-accent"><Select.ItemText>{label}</Select.ItemText><Select.ItemIndicator className="absolute right-2"><Check size={14} /></Select.ItemIndicator></Select.Item>)}</Select.Viewport></Select.Content></Select.Portal>
                      </Select.Root>
                    </label>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-4 text-xs leading-5 text-muted-foreground">使用手机 QQ 扫描二维码并选择要绑定的 QQ 机器人。扫码成功后，机器人凭据只在服务端验证并加密保存。</div>
                  {qrSessionId && (qrStatus === "pending" || qrStatus === "scanning") && qrRevision > 0 ? (
                    <div className="flex justify-center rounded-md border bg-white p-4"><Image key={qrRevision} src={`/api/bot-qr-sessions/${qrSessionId}/qr?revision=${qrRevision}`} alt="QQ 机器人绑定二维码" width={256} height={256} className="h-64 w-64" unoptimized /></div>
                  ) : (
                    <div className="grid h-72 place-items-center rounded-md border border-dashed bg-muted/20 text-center text-xs text-muted-foreground">{qrSessionId ? "正在生成二维码..." : "点击下方按钮生成二维码"}</div>
                  )}
                  {qrSessionId && (qrStatus === "pending" || qrStatus === "scanning") && <div className="text-center text-xs text-muted-foreground">{qrStatus === "scanning" ? "等待手机 QQ 确认绑定..." : "正在连接 QQ 扫码服务..."}</div>}
                  {qrError && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{qrError}</div>}
                  <div className="flex justify-end gap-2 pt-1">
                    {qrSessionId && (qrStatus === "pending" || qrStatus === "scanning") ? <Button type="button" variant="outline" onClick={() => void cancelQr()}>取消扫码</Button> : <Button type="button" onClick={() => void startQr()} disabled={qrStarting}><QrCode size={15} />{qrStarting ? "正在生成..." : "生成扫码二维码"}</Button>}
                  </div>
                </div>
              ) : (
            <form onSubmit={submit} className="space-y-4">
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
            </div>
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
  initialPluginCenter,
  initialMembers,
  site,
  timeZone,
}: {
  user: SessionUser;
  initialBots: Bot[];
  initialEvents: EventLog[];
  initialPluginCenter: PluginCenterData;
  initialMembers: TeamMember[];
  site: SitePublicSettings;
  timeZone: string;
}) {
  const [activeView, setActiveView] = useState<ViewKey>("overview");
  const [currentUser, setCurrentUser] = useState<SessionUser>(user);
  const [currentSite, setCurrentSite] = useState<SitePublicSettings>(site);
  const [currentTimeZone, setCurrentTimeZone] = useState(timeZone);
  const [bots, setBots] = useState<Bot[]>(initialBots);
  const [events, setEvents] = useState<EventLog[]>(initialEvents);
  const [pluginCenter, setPluginCenter] = useState<PluginCenterData>(initialPluginCenter);
  const [members, setMembers] = useState<TeamMember[]>(initialMembers);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [addBotOpen, setAddBotOpen] = useState(false);
  const meta = viewMeta[activeView];
  const effectiveQuota = members.find((member) => member.id === currentUser.id)?.botQuota ?? currentUser.botQuota;
  const quotaUsage = effectiveQuota ? Math.min(100, (bots.length / effectiveQuota) * 100) : 100;

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const [botsResponse, eventsResponse, pluginCenterResponse, usersResponse] = await Promise.all([
        fetch("/api/bots", { cache: "no-store" }),
        fetch("/api/events?limit=100", { cache: "no-store" }),
        fetch("/api/plugin-center", { cache: "no-store" }),
        fetch("/api/users", { cache: "no-store" }),
      ]);
      if (cancelled) return;
      if (botsResponse.ok) setBots(((await botsResponse.json()) as { bots: Bot[] }).bots);
      if (eventsResponse.ok) setEvents(((await eventsResponse.json()) as { events: EventLog[] }).events);
      if (pluginCenterResponse.ok) setPluginCenter(await pluginCenterResponse.json() as PluginCenterData);
      if (usersResponse.ok) setMembers(((await usersResponse.json()) as { users: TeamMember[] }).users);
    }

    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    document.title = currentSite.siteName;
    if (!currentSite.faviconUrl) return;
    let icon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!icon) {
      icon = document.createElement("link");
      icon.rel = "icon";
      document.head.appendChild(icon);
    }
    icon.href = currentSite.faviconUrl;
  }, [currentSite]);

  function navigate(view: string) {
    setActiveView(view as ViewKey);
    setMobileOpen(false);
  }

  async function refreshPluginCenter() {
    const response = await fetch("/api/plugin-center", { cache: "no-store" });
    if (!response.ok) throw new Error("插件中心刷新失败");
    setPluginCenter(await response.json() as PluginCenterData);
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError("");
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message || "退出登录失败");
      window.location.replace("/login");
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : "退出登录失败，请重试");
      setLoggingOut(false);
    }
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
    const accountNav: NavItem[] = [
      { key: "membership", label: "会员与账单", icon: CreditCard },
    ];
    const adminNav: NavItem[] = [
      { key: "team", label: "团队成员", icon: Users },
      { key: "admin", label: "用户设置", icon: ShieldCheck },
      { key: "auth", label: "登录与注册", icon: KeyRound },
      { key: "settings", label: "系统设置", icon: Settings2 },
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
          <BrandMark compact={compact} site={currentSite} />
          {mobile && (
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="关闭导航"><X size={18} /></Button>
            </Dialog.Close>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-5">
          {group("工作区", workspaceNav)}
          {group("开发", buildNav)}
          {group("账户", accountNav)}
          {currentUser.role === "admin" && group("管理", adminNav)}
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
    <TimeZoneProvider timeZone={currentTimeZone}>
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
                      {currentUser.name.slice(0, 1)}
                    </span>
                    <span className="hidden max-w-28 truncate text-xs sm:block">{currentUser.name}</span>
                    <ChevronDown size={13} className="text-muted-foreground" />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg">
                    <div className="border-b px-2 py-2.5">
                      <div className="text-sm font-medium">{currentUser.name}</div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">{currentUser.email}</div>
                      <Badge variant="outline" className="mt-2">{currentUser.membershipName}</Badge>
                    </div>
                    {logoutError && <div role="alert" className="mx-1 mt-1 rounded-sm bg-red-50 px-2.5 py-2 text-[11px] leading-4 text-red-700">{logoutError}</div>}
                    <DropdownMenu.Item
                      disabled={loggingOut}
                      onSelect={(event) => { event.preventDefault(); void logout(); }}
                      className="mt-1 flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm text-red-600 outline-none data-[disabled]:cursor-wait data-[disabled]:opacity-60 data-[highlighted]:bg-red-50"
                    >
                      <LogOut size={15} />{loggingOut ? "正在退出..." : "退出登录"}
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
            {activeView === "plugins" && <PluginsView bots={bots} data={pluginCenter} userRole={currentUser.role} onRefresh={refreshPluginCenter} />}
            {activeView === "developer" && <DeveloperView bots={bots} />}
            {activeView === "membership" && <MembershipView user={currentUser} onMembershipChange={({ plan, botQuota }) => {
              setCurrentUser((value) => ({ ...value, membershipPlan: plan.id, membershipName: plan.name, botQuota }));
              setMembers((current) => current.map((member) => member.id === currentUser.id ? { ...member, membershipPlan: plan.id, membershipName: plan.name, botQuota } : member));
            }} />}
            {activeView === "team" && <TeamView members={members} />}
            {activeView === "admin" && currentUser.role === "admin" && <AdminView currentUserId={currentUser.id} initialMembers={members} onMembersChange={setMembers} />}
            {activeView === "auth" && currentUser.role === "admin" && <SystemSettingsView area="auth" onSiteChange={setCurrentSite} onTimeZoneChange={setCurrentTimeZone} />}
            {activeView === "settings" && currentUser.role === "admin" && <SystemSettingsView area="system" onSiteChange={setCurrentSite} onTimeZoneChange={setCurrentTimeZone} />}
          </main>
          <SiteFooter site={currentSite} />
        </div>

        <AddBotDialog
          open={addBotOpen}
          onOpenChange={setAddBotOpen}
          used={bots.length}
          quota={effectiveQuota}
          onQrCompleted={async () => {
            const response = await fetch("/api/bots", { cache: "no-store" });
            if (response.ok) setBots(((await response.json()) as { bots: Bot[] }).bots);
            setActiveView("bots");
          }}
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
    </TimeZoneProvider>
  );
}
