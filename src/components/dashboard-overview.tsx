"use client";

import * as Progress from "@radix-ui/react-progress";
import { Activity, ArrowUpRight, Bot as BotIcon, Clock3, Gauge, MessageSquareText, Plus, Radio, Server, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { useTimeZone } from "@/components/time-zone-provider";
import { formatDateTime, hourInTimeZone } from "@/lib/date-time";
import { cn, formatNumber } from "@/lib/utils";
import type { Bot, EventLog } from "@/types/platform";

type DashboardOverviewProps = {
  bots: Bot[];
  eventLogs: EventLog[];
  onAddBot: () => void;
  onNavigate: (view: string) => void;
};

function buildLinePath(values: number[], width: number, height: number) {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  return values.map((value, index) => {
    const x = (index / Math.max(1, values.length - 1)) * width;
    const y = height - ((value - minimum) / range) * height;
    return (index === 0 ? "M" : "L") + x.toFixed(2) + "," + y.toFixed(2);
  }).join(" ");
}

function BotStatusBadge({ status }: { status: Bot["status"] }) {
  const values = {
    online: { label: "运行中", variant: "success" as const },
    degraded: { label: "需关注", variant: "warning" as const },
    offline: { label: "已离线", variant: "secondary" as const },
  };
  return <Badge variant={values[status].variant}>{values[status].label}</Badge>;
}

export function DashboardOverview({ bots, eventLogs, onAddBot, onNavigate }: DashboardOverviewProps) {
  const timeZone = useTimeZone();
  const messageCount = bots.reduce((sum, bot) => sum + bot.messageCount, 0);
  const successRate = bots.length ? bots.reduce((sum, bot) => sum + bot.successRate, 0) / bots.length : 0;
  const averageLatency = bots.length ? bots.reduce((sum, bot) => sum + bot.latency, 0) / bots.length : 0;
  const onlineCount = bots.filter((bot) => bot.status === "online").length;
  const healthScore = bots.length ? Math.round((onlineCount / bots.length) * 100) : 0;
  const activitySeries = Array.from({ length: 24 }, () => 0);

  for (const event of eventLogs) {
    const hour = hourInTimeZone(event.time, timeZone);
    if (Number.isInteger(hour) && hour >= 0 && hour < 24) activitySeries[hour] += 1;
  }

  const linePath = buildLinePath(activitySeries, 760, 190);
  const stats = [
    { label: "已记录事件", value: formatNumber(eventLogs.length), icon: Activity, detail: "当前查询窗口" },
    { label: "消息事件", value: formatNumber(messageCount), icon: MessageSquareText, detail: "机器人累计数据" },
    { label: "平均成功率", value: successRate.toFixed(2) + "%", icon: Gauge, detail: "所有可见机器人" },
    { label: "平均延迟", value: Math.round(averageLatency) + "ms", icon: Zap, detail: "机器人聚合指标" },
  ];

  return (
    <div>
      <PageHeader
        title="工作台总览"
        description="查看机器人连接、消息处理和事件入库的实时状态。"
        action={<Button onClick={onAddBot}><Plus size={15} />添加机器人</Button>}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-medium text-muted-foreground">{stat.label}</div>
                  <div className="mono-data mt-3 text-2xl font-semibold text-foreground">{stat.value}</div>
                </div>
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                  <stat.icon size={17} />
                </div>
              </div>
              <div className="mt-4 text-[11px] text-muted-foreground">{stat.detail}</div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.75fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between border-b">
            <div>
              <CardTitle>事件处理趋势</CardTitle>
              <CardDescription>按接收时间聚合最近记录</CardDescription>
            </div>
            <Badge variant="outline"><span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-info" />真实入库事件</Badge>
          </CardHeader>
          <CardContent className="p-5">
            <div className="flex items-baseline gap-2">
              <span className="mono-data text-2xl font-semibold">{eventLogs.length}</span>
              <span className="text-xs text-muted-foreground">条事件</span>
            </div>
            <div className="relative mt-4 h-[220px] min-w-0 overflow-hidden">
              <div className="absolute inset-0 grid grid-rows-4">
                {[0, 1, 2, 3].map((row) => <div key={row} className="border-t border-dashed" />)}
              </div>
              <svg viewBox="0 0 760 190" className="absolute inset-x-0 bottom-4 h-[190px] w-full" preserveAspectRatio="none" aria-label="事件处理趋势折线图">
                <path d={linePath} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" className="text-info" />
              </svg>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle>连接健康度</CardTitle>
              <CardDescription>WebSocket 与 Webhook 综合状态</CardDescription>
            </div>
            <Radio size={17} className="text-info" />
          </CardHeader>
          <CardContent>
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="mono-data text-3xl font-semibold">{healthScore}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">在线机器人占比 / 100</div>
              </div>
              <Badge variant={onlineCount ? "success" : "secondary"}>{onlineCount}/{bots.length} 在线</Badge>
            </div>
            <Progress.Root value={healthScore} className="mt-5 h-1.5 overflow-hidden rounded-full bg-muted">
              <Progress.Indicator className="h-full bg-success transition-transform" style={{ transform: "translateX(-" + (100 - healthScore) + "%)" }} />
            </Progress.Root>
            <div className="mt-7 space-y-4">
              <div className="flex justify-between gap-5 text-xs">
                <span className="flex items-center gap-2 text-muted-foreground"><Server size={14} />在线接入</span>
                <span className="mono-data">{onlineCount}</span>
              </div>
              <div className="flex justify-between gap-5 text-xs">
                <span className="flex items-center gap-2 text-muted-foreground"><Clock3 size={14} />最近事件</span>
                <span className="truncate text-right">{eventLogs[0] ? formatDateTime(eventLogs[0].time, timeZone, { dateStyle: "short", timeStyle: "medium" }) : "暂无"}</span>
              </div>
            </div>
            <Button variant="ghost" className="mt-5 w-full justify-between border-t pt-4" onClick={() => onNavigate("events")}>
              查看事件日志<ArrowUpRight size={14} />
            </Button>
          </CardContent>
        </Card>
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between border-b">
            <div>
              <CardTitle>我的机器人</CardTitle>
              <CardDescription>{bots.length} 个数据库实例</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={onAddBot}><Plus size={14} />添加</Button>
          </CardHeader>
          {bots.length ? (
            <div className="divide-y">
              {bots.map((bot) => (
                <button key={bot.id} onClick={() => onNavigate("bots")} className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/50">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">{bot.avatar}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{bot.name}</div>
                    <div className="mono-data mt-1 truncate text-[10px] text-muted-foreground">APPID {bot.appId}</div>
                  </div>
                  <BotStatusBadge status={bot.status} />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState icon={BotIcon} title="尚未添加机器人" action={<Button size="sm" onClick={onAddBot}><Plus size={14} />添加机器人</Button>} />
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between border-b">
            <div>
              <CardTitle>最新事件</CardTitle>
              <CardDescription>来自 SQLite 事件日志</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onNavigate("events")}>查看全部</Button>
          </CardHeader>
          {eventLogs.length ? (
            <div className="divide-y">
              {eventLogs.slice(0, 4).map((event) => (
                <div key={event.id} className="flex items-start gap-3 px-5 py-4">
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", event.status === "success" ? "bg-emerald-500" : event.status === "warning" ? "bg-amber-500" : "bg-red-500")} />
                  <div className="min-w-0 flex-1">
                    <div className="mono-data truncate text-[11px] font-medium">{event.type}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{event.content || event.botName}</div>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{formatDateTime(event.time, timeZone, { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Activity} title="暂无事件" description="机器人接入成功后，事件会显示在这里。" />
          )}
        </Card>
      </section>
    </div>
  );
}
