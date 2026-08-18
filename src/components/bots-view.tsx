"use client";

import { useMemo, useState } from "react";
import * as Select from "@radix-ui/react-select";
import { Activity, Bot as BotIcon, Check, ChevronDown, Clock3, Copy, Gauge, PlugZap, Plus, Power, RefreshCcw, Search, ShieldCheck, Trash2, Webhook } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useTimeZone } from "@/components/time-zone-provider";
import { formatDateTime } from "@/lib/date-time";
import { cn, formatNumber } from "@/lib/utils";
import type { Bot } from "@/types/platform";

function StatusBadge({ status }: { status: Bot["status"] }) {
  const values = {
    online: { label: "在线", variant: "success" as const },
    degraded: { label: "需关注", variant: "warning" as const },
    offline: { label: "离线", variant: "secondary" as const },
  };
  return <Badge variant={values[status].variant}>{values[status].label}</Badge>;
}

export function BotsView({ bots, onAddBot, onRefresh }: { bots: Bot[]; onAddBot: () => void; onRefresh: () => Promise<void> }) {
  const timeZone = useTimeZone();
  const [selectedBotId, setSelectedBotId] = useState(bots[0]?.id || "");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [callbackCopied, setCallbackCopied] = useState(false);

  const filteredBots = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return bots;
    return bots.filter((bot) => bot.name.toLowerCase().includes(normalizedQuery) || bot.appId.toLowerCase().includes(normalizedQuery));
  }, [bots, query]);

  const selected = bots.find((bot) => bot.id === selectedBotId) || bots[0];

  async function toggleConnection() {
    if (!selected || selected.connectionMode !== "websocket") return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/bots/" + selected.id + "/connect", { method: selected.status === "online" ? "DELETE" : "POST" });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message || "Gateway 操作失败");
      await new Promise((resolve) => window.setTimeout(resolve, 600));
      await onRefresh();
    } catch (connectionError) {
      setError(connectionError instanceof Error ? connectionError.message : "Gateway 操作失败");
    } finally {
      setBusy(false);
    }
  }

  async function changeConnectionMode(connectionMode: Bot["connectionMode"]) {
    if (!selected || selected.connectionMode === connectionMode) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/bots/" + selected.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionMode }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message || "接入方式更新失败");
      await onRefresh();
    } catch (modeError) {
      setError(modeError instanceof Error ? modeError.message : "接入方式更新失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeBot() {
    if (!selected || !window.confirm("确定删除该机器人及其事件、插件安装和远程应用数据吗？")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/bots/" + selected.id, { method: "DELETE" });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message || "删除失败");
      setSelectedBotId("");
      await onRefresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function copyWebhookUrl() {
    if (!selected) return;
    await navigator.clipboard.writeText(window.location.origin + selected.webhookPath);
    setCallbackCopied(true);
    window.setTimeout(() => setCallbackCopied(false), 1400);
  }

  return (
    <div>
      <PageHeader
        title="机器人实例"
        description="管理加密凭据、事件接入方式和机器人运行指标。"
        action={<Button onClick={onAddBot}><Plus size={15} />添加机器人</Button>}
      />

      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="h-fit overflow-hidden">
          <div className="border-b p-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9 text-xs" placeholder="搜索机器人或 AppID" />
            </div>
          </div>
          <div className="max-h-[520px] overflow-y-auto p-2">
            {filteredBots.length ? filteredBots.map((bot) => (
              <button
                key={bot.id}
                type="button"
                onClick={() => setSelectedBotId(bot.id)}
                className={cn("mb-1 flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition-colors", selected?.id === bot.id ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
              >
                <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-md text-xs font-semibold", selected?.id === bot.id ? "bg-primary-foreground/10" : "bg-muted text-foreground")}>{bot.avatar}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{bot.name}</div>
                  <div className="mono-data mt-1 truncate text-[9px] opacity-60">{bot.appId}</div>
                </div>
                <span className={cn("h-2 w-2 shrink-0 rounded-full", bot.status === "online" ? "bg-emerald-400" : bot.status === "degraded" ? "bg-amber-400" : "bg-zinc-400")} />
              </button>
            )) : (
              <EmptyState icon={BotIcon} title={bots.length ? "没有匹配的机器人" : "暂无机器人"} />
            )}
          </div>
        </Card>

        {selected ? (
          <div className="min-w-0 space-y-5">
            <Card className="overflow-hidden">
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-4 border-b">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">{selected.avatar}</div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="truncate text-base">{selected.name}</CardTitle>
                      <StatusBadge status={selected.status} />
                    </div>
                    <CardDescription className="mono-data mt-1 truncate">APPID {selected.appId}</CardDescription>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selected.connectionMode === "websocket" ? (
                    <Button size="sm" disabled={busy} onClick={() => void toggleConnection()}>
                      {selected.status === "online" ? <Power size={14} /> : <PlugZap size={14} />}
                      {selected.status === "online" ? "断开连接" : "连接 WebSocket"}
                    </Button>
                  ) : (
                    <Button size="sm" disabled={busy} onClick={() => void copyWebhookUrl()}>
                      <Webhook size={14} />{callbackCopied ? "已复制" : "复制回调地址"}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void removeBot()} className="text-red-600 hover:text-red-700">
                    <Trash2 size={14} />删除
                  </Button>
                </div>
              </CardHeader>
              {error && <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-xs text-red-700">{error}</div>}
              <div className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
                {([
                  [Activity, "事件数量", formatNumber(selected.eventsToday)],
                  [Gauge, "成功率", selected.successRate + "%"],
                  [Clock3, "平均延迟", selected.latency + " ms"],
                  [BotIcon, "消息事件", formatNumber(selected.messageCount)],
                ] as const).map(([Icon, label, value]) => (
                  <div key={label} className="p-5">
                    <Icon size={15} className="text-muted-foreground" />
                    <div className="mt-4 text-[11px] font-medium text-muted-foreground">{label}</div>
                    <div className="mono-data mt-2 text-lg font-semibold">{value}</div>
                  </div>
                ))}
              </div>
            </Card>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <div>
                    <CardTitle>接入信息</CardTitle>
                    <CardDescription>{selected.connectionMode === "websocket" ? "由 Gateway 会话实时更新" : "由 QQ 官方签名回调更新"}</CardDescription>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => void onRefresh()} aria-label="刷新连接信息"><RefreshCcw size={15} /></Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between gap-6 text-xs">
                    <span className="text-muted-foreground">接入方式</span>
                    <Select.Root value={selected.connectionMode} disabled={busy} onValueChange={(value) => void changeConnectionMode(value as Bot["connectionMode"])}>
                      <Select.Trigger className="flex h-8 min-w-44 items-center justify-between gap-3 rounded-md border bg-background px-2.5 text-xs outline-none focus:ring-2 focus:ring-ring">
                        <Select.Value />
                        <Select.Icon><ChevronDown size={13} className="text-muted-foreground" /></Select.Icon>
                      </Select.Trigger>
                      <Select.Portal>
                        <Select.Content position="popper" sideOffset={6} className="z-50 min-w-[var(--radix-select-trigger-width)] rounded-md border bg-popover p-1 shadow-lg">
                          <Select.Viewport>
                            <Select.Item value="websocket" className="relative flex cursor-default items-center rounded-sm px-2 py-2 pr-7 outline-none data-[highlighted]:bg-accent"><Select.ItemText>WebSocket · 平台托管</Select.ItemText><Select.ItemIndicator className="absolute right-2"><Check size={13} /></Select.ItemIndicator></Select.Item>
                            <Select.Item value="webhook" className="relative flex cursor-default items-center rounded-sm px-2 py-2 pr-7 outline-none data-[highlighted]:bg-accent"><Select.ItemText>Webhook · QQ 官方推送</Select.ItemText><Select.ItemIndicator className="absolute right-2"><Check size={13} /></Select.ItemIndicator></Select.Item>
                          </Select.Viewport>
                        </Select.Content>
                      </Select.Portal>
                    </Select.Root>
                  </div>
                  {[
                    ["使用阶段", selected.environment === "production" ? "正式使用" : "测试使用"],
                    ["接入状态", selected.status],
                    ...(selected.connectionMode === "websocket" ? [["Gateway 分片", selected.shardCount ? `${selected.onlineShards} / ${selected.shardCount}` : "连接后自动获取"]] : []),
                    ["最近活动", selected.lastSeen === "尚未连接" ? selected.lastSeen : formatDateTime(selected.lastSeen, timeZone, { dateStyle: "short", timeStyle: "medium" })],
                    ["事件范围", selected.connectionMode === "websocket" ? "服务端策略：群聊与单聊" : "QQ 后台已订阅事件"],
                    ["权限来源", "QQ 开放平台后台配置"],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-6 text-xs">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="min-w-0 break-all text-right font-medium">{value}</span>
                    </div>
                  ))}
                  {selected.connectionMode === "webhook" && <div className="border-t pt-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-xs font-medium">QQ 官方 Webhook</span>
                      <Button variant="ghost" size="sm" onClick={() => void copyWebhookUrl()}><Copy size={13} />{callbackCopied ? "已复制" : "复制"}</Button>
                    </div>
                    <div className="mono-data break-all rounded-md bg-muted px-3 py-2 text-[10px] text-muted-foreground">{selected.webhookPath}</div>
                  </div>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>凭据安全</CardTitle>
                  <CardDescription>密钥只在服务端解密使用</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-start gap-3 bg-emerald-50 p-4 text-emerald-900">
                    <ShieldCheck size={18} className="mt-0.5 shrink-0 text-emerald-700" />
                    <div>
                      <div className="text-xs font-semibold">Client Secret 已使用 AES-256-GCM 加密</div>
                      <p className="mt-1.5 text-[11px] leading-5 text-emerald-800">数据库保存密文，Access Token 仅存在于服务端内存缓存。</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <Card className="min-h-80">
            <EmptyState icon={BotIcon} title="还没有机器人" description="添加机器人后即可选择 WebSocket 或 Webhook 接入。" action={<Button size="sm" onClick={onAddBot}><Plus size={14} />添加机器人</Button>} />
          </Card>
        )}
      </div>
    </div>
  );
}
