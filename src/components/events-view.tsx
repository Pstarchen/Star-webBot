"use client";

import { useMemo, useState } from "react";
import { Activity, ArrowDownToLine, Check, Copy, RefreshCcw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { useTimeZone } from "@/components/time-zone-provider";
import { formatDateTime } from "@/lib/date-time";
import { cn } from "@/lib/utils";
import type { EventLog } from "@/types/platform";

const emptyEvent: EventLog = {
  id: "",
  type: "NO_EVENT",
  botName: "-",
  scene: "系统",
  status: "success",
  latency: 0,
  time: new Date(0).toISOString(),
  content: "暂无事件",
  payload: {},
  traceId: null,
};

function EventStatusBadge({ status }: { status: EventLog["status"] }) {
  const values = {
    success: { label: "成功", variant: "success" as const },
    warning: { label: "警告", variant: "warning" as const },
    failed: { label: "失败", variant: "destructive" as const },
  };
  return <Badge variant={values[status].variant}>{values[status].label}</Badge>;
}

export function EventsView({ events, onRefresh }: { events: EventLog[]; onRefresh: () => Promise<void> }) {
  const timeZone = useTimeZone();
  const [activeEventId, setActiveEventId] = useState(events[0]?.id || "");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | EventLog["status"]>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

  const filteredEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return events.filter((event) => {
      if (status !== "all" && event.status !== status) return false;
      if (!normalizedQuery) return true;
      return [event.type, event.botName, event.scene, event.content, event.traceId || ""]
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [events, query, status]);

  const activeEvent = filteredEvents.find((event) => event.id === activeEventId) || filteredEvents[0] || emptyEvent;

  async function refresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  function exportLogs() {
    const blob = new Blob([JSON.stringify(filteredEvents, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "starbot-events-" + new Date().toISOString().replaceAll(":", "-") + ".json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function copyPayload() {
    await navigator.clipboard.writeText(JSON.stringify(activeEvent.payload || {}, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div>
      <PageHeader
        title="事件中心"
        description="查询已写入 SQLite 的 WebSocket、Webhook 和 API 调用事件。"
        action={<Button variant="outline" onClick={exportLogs} disabled={!filteredEvents.length}><ArrowDownToLine size={15} />导出结果</Button>}
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center">
          <div className="relative min-w-0 flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9 text-xs" placeholder="搜索事件、机器人、内容或 Trace ID" />
          </div>
          <Select
            value={status}
            onValueChange={(value) => setStatus(value as "all" | EventLog["status"])}
            options={[
              { value: "all", label: "全部状态" },
              { value: "success", label: "成功" },
              { value: "warning", label: "警告" },
              { value: "failed", label: "失败" },
            ]}
            ariaLabel="筛选事件状态"
            className="text-xs md:w-36"
          />
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCcw size={14} className={refreshing ? "animate-spin" : ""} />刷新
          </Button>
        </div>

        <div className="grid min-h-[520px] lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div className="min-w-0 border-b lg:border-b-0 lg:border-r">
            <div className="hidden grid-cols-[90px_minmax(160px,1fr)_100px_64px] gap-3 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-medium text-muted-foreground md:grid">
              <span>时间</span><span>事件</span><span>机器人</span><span>耗时</span>
            </div>
            {!filteredEvents.length ? (
              <EmptyState icon={Activity} title="没有符合条件的事件" description="机器人接入或调用 API 后，事件会自动写入。" />
            ) : (
              <div className="max-h-[580px] overflow-y-auto">
                {filteredEvents.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => setActiveEventId(event.id)}
                    className={cn(
                      "flex w-full flex-col gap-2 border-b px-4 py-4 text-left transition-colors hover:bg-muted/50 md:grid md:grid-cols-[90px_minmax(160px,1fr)_100px_64px] md:gap-3",
                      activeEvent.id === event.id && "bg-muted",
                    )}
                  >
                    <span className="mono-data text-[10px] text-muted-foreground md:text-xs">{formatDateTime(event.time, timeZone, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    <span className="min-w-0">
                      <span className="mono-data block truncate text-xs font-medium">{event.type}</span>
                      <span className="mt-1 block truncate text-[11px] text-muted-foreground">{event.content || "无内容摘要"}</span>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{event.botName}</span>
                    <span className={cn("mono-data text-xs", event.status === "failed" || event.latency > 500 ? "text-red-600" : "text-muted-foreground")}>{event.latency}ms</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <aside className="min-w-0 bg-muted/20 p-5">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">事件载荷</div>
              <Button variant="ghost" size="icon" onClick={() => void copyPayload()} disabled={!activeEvent.id} aria-label="复制载荷">
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </Button>
            </div>
            <div className="mt-5 space-y-4 text-xs">
              <div>
                <div className="data-label">事件类型</div>
                <div className="mono-data mt-1.5 break-all font-medium">{activeEvent.type}</div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><div className="data-label">场景</div><div className="mt-1.5">{activeEvent.scene}</div></div>
                <div><div className="data-label">处理耗时</div><div className="mono-data mt-1.5">{activeEvent.latency} ms</div></div>
              </div>
              <div><div className="data-label">状态</div><div className="mt-1.5"><EventStatusBadge status={activeEvent.status} /></div></div>
              <div><div className="data-label">Trace ID</div><div className="mono-data mt-1.5 break-all">{activeEvent.traceId || "无"}</div></div>
              <div><div className="data-label">内容摘要</div><div className="mt-1.5 break-words leading-5">{activeEvent.content || "无"}</div></div>
            </div>
            <pre className="mono-data mt-5 max-h-[300px] max-w-full overflow-auto rounded-md bg-zinc-950 p-4 text-[10px] leading-5 text-zinc-200">{JSON.stringify(activeEvent.payload || {}, null, 2)}</pre>
          </aside>
        </div>
      </Card>
    </div>
  );
}
