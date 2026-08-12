"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Blocks, Code2, Copy, Inbox, KeyRound, MoreHorizontal, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { Bot, Plugin } from "@/types/platform";

type PluginsViewProps = {
  bots: Bot[];
  plugins: Plugin[];
  onToggle: (id: string) => Promise<void>;
  onCreated: (plugin: Plugin) => void;
  onDeleted: (pluginId: string) => void;
};

export function PluginsView({ bots, plugins, onToggle, onCreated, onDeleted }: PluginsViewProps) {
  const [open, setOpen] = useState(false);
  const [botId, setBotId] = useState(bots[0]?.id || "");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [events, setEvents] = useState("C2C_MESSAGE_CREATE,GROUP_AT_MESSAGE_CREATE");
  const [allowQqApi, setAllowQqApi] = useState(false);
  const [createdPluginId, setCreatedPluginId] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [togglingPluginId, setTogglingPluginId] = useState("");
  const enabledCount = plugins.filter((plugin) => plugin.enabled).length;
  const pendingCount = plugins.reduce((sum, plugin) => sum + plugin.pendingEvents, 0);

  async function createPlugin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botId: botId || bots[0]?.id,
          name,
          slug,
          version: "1.0.0",
          events: events.split(",").map((item) => item.trim()).filter(Boolean),
          permissions: allowQqApi ? ["event:receive", "qq:api"] : ["event:receive"],
        }),
      });
      const body = await response.json().catch(() => ({})) as { plugin?: Plugin; signingSecret?: string; message?: string };
      if (!response.ok || !body.plugin || !body.signingSecret) throw new Error(body.message || "SDK 应用创建失败");
      onCreated(body.plugin);
      setCreatedPluginId(body.plugin.id);
      setSigningSecret(body.signingSecret);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "SDK 应用创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function togglePlugin(pluginId: string) {
    setTogglingPluginId(pluginId);
    setError("");
    try { await onToggle(pluginId); }
    catch (toggleError) { setError(toggleError instanceof Error ? toggleError.message : "应用状态更新失败"); }
    finally { setTogglingPluginId(""); }
  }

  function resetDialog(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen && !botId && bots[0]) setBotId(bots[0].id);
    if (!nextOpen) {
      setCreatedPluginId("");
      setSigningSecret("");
      setError("");
      setName("");
      setSlug("");
      setAllowQqApi(false);
    }
  }

  async function copyCredentials() {
    await navigator.clipboard.writeText(`STARBOT_PLUGIN_ID=${createdPluginId}\nSTARBOT_PLUGIN_SECRET=${signingSecret}`);
  }

  async function rotateSecret(pluginId: string) {
    if (!window.confirm("轮换后旧密钥会立即失效，是否继续？")) return;
    setError("");
    const response = await fetch("/api/plugins/" + pluginId, { method: "POST" });
    const body = await response.json().catch(() => ({})) as { signingSecret?: string; message?: string };
    if (!response.ok || !body.signingSecret) {
      setError(body.message || "SDK 密钥轮换失败");
      return;
    }
    setCreatedPluginId(pluginId);
    setSigningSecret(body.signingSecret);
    setOpen(true);
  }

  async function removePlugin(pluginId: string) {
    if (!window.confirm("确定删除该 SDK 应用及其待处理事件吗？")) return;
    setError("");
    const response = await fetch("/api/plugins/" + pluginId, { method: "DELETE" });
    const body = await response.json().catch(() => ({})) as { message?: string };
    if (!response.ok) {
      setError(body.message || "SDK 应用删除失败");
      return;
    }
    onDeleted(pluginId);
  }

  return (
    <div>
      <PageHeader
        title="SDK 应用"
        description="通过 SDK 消费机器人事件并调用受控的 QQ Bot API。"
        action={<Button disabled={!bots.length} onClick={() => setOpen(true)}><Plus size={15} />创建 SDK 应用</Button>}
      />

      <section className="mb-5 grid gap-4 sm:grid-cols-3">
        {([[Blocks, "应用总数", plugins.length], [Code2, "运行中", enabledCount], [Inbox, "待处理事件", pendingCount]] as const).map(([Icon, label, value]) => (
          <Card key={label}><CardContent className="flex items-center justify-between p-5"><div><div className="text-xs text-muted-foreground">{label}</div><div className="mono-data mt-2 text-2xl font-semibold">{value}</div></div><div className="grid h-9 w-9 place-items-center rounded-md bg-muted text-muted-foreground"><Icon size={17} /></div></CardContent></Card>
        ))}
      </section>

      {error && !open && <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>}

      {plugins.length ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {plugins.map((plugin) => (
            <Card key={plugin.id} className="flex min-h-[230px] flex-col">
              <CardContent className="flex flex-1 flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-md bg-muted text-foreground"><Code2 size={18} /></div>
                  <div className="flex items-center gap-2">
                    <Switch checked={plugin.enabled} disabled={togglingPluginId === plugin.id} onCheckedChange={() => void togglePlugin(plugin.id)} aria-label={plugin.enabled ? "停用 SDK 应用" : "启用 SDK 应用"} />
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" aria-label="SDK 应用操作"><MoreHorizontal size={16} /></Button></DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 w-40 rounded-md border bg-popover p-1 text-xs shadow-lg">
                          <DropdownMenu.Item onSelect={() => void rotateSecret(plugin.id)} className="flex cursor-default items-center gap-2 rounded-sm px-2 py-2 outline-none data-[highlighted]:bg-accent"><RefreshCw size={13} />轮换密钥</DropdownMenu.Item>
                          <DropdownMenu.Item onSelect={() => void removePlugin(plugin.id)} className="flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-red-600 outline-none data-[highlighted]:bg-red-50"><Trash2 size={13} />删除应用</DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </div>
                </div>
                <div className="mt-5 flex min-w-0 items-center gap-2"><h3 className="truncate text-sm font-semibold">{plugin.name}</h3><Badge variant="outline" className="mono-data shrink-0">v{plugin.version}</Badge></div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{plugin.description}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">{plugin.permissions.map((permission) => <Badge key={permission} variant="secondary" className="mono-data">{permission}</Badge>)}</div>
                <div className="mt-auto flex items-center justify-between gap-3 border-t pt-4 text-[10px] text-muted-foreground"><span>{plugin.pendingEvents} 个待处理事件</span><Badge variant={plugin.enabled ? "success" : "secondary"}>{plugin.enabled ? "等待 SDK" : "已停用"}</Badge></div>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : (
        <Card><EmptyState icon={Code2} title="尚未创建 SDK 应用" description={bots.length ? "创建应用后即可使用 SDK 消费事件。" : "请先添加机器人。"} action={bots.length ? <Button size="sm" onClick={() => setOpen(true)}><Plus size={14} />创建应用</Button> : undefined} /></Card>
      )}

      <Dialog.Root open={open} onOpenChange={resetDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
          <Dialog.Content className="modal-panel fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-32px)] w-[calc(100%-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-card p-5 shadow-2xl outline-none sm:p-6">
            <div className="flex items-start justify-between gap-4"><div><Dialog.Title className="text-lg font-semibold">创建 SDK 应用</Dialog.Title><Dialog.Description className="mt-1.5 text-sm leading-6 text-muted-foreground">应用 ID 与密钥用于 SDK 签名认证，密钥只展示一次。</Dialog.Description></div><Dialog.Close asChild><Button variant="ghost" size="icon" className="-mr-2 -mt-2" aria-label="关闭"><X size={17} /></Button></Dialog.Close></div>
            {signingSecret ? (
              <div className="mt-6">
                <div className="border bg-muted/40 p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold"><KeyRound size={14} />SDK 凭据</div>
                  <div className="mt-4 space-y-3"><div><div className="data-label">应用 ID</div><code className="mono-data mt-1 block break-all text-[11px]">{createdPluginId}</code></div><div><div className="data-label">应用密钥</div><code className="mono-data mt-1 block break-all text-[11px]">{signingSecret}</code></div></div>
                  <Button type="button" variant="outline" size="sm" onClick={() => void copyCredentials()} className="mt-4 bg-background"><Copy size={13} />复制环境变量</Button>
                </div>
                <Dialog.Close asChild><Button className="mt-5 w-full">我已保存</Button></Dialog.Close>
              </div>
            ) : (
              <form onSubmit={createPlugin} className="mt-5 space-y-4">
                <label className="block"><span className="field-label">绑定机器人</span><Select value={botId || bots[0]?.id || ""} onValueChange={setBotId} options={bots.map((bot) => ({ value: bot.id, label: bot.name }))} placeholder="请选择机器人" ariaLabel="选择绑定机器人" /></label>
                <label className="block"><span className="field-label">应用名称</span><Input value={name} onChange={(event) => setName(event.target.value)} required /></label>
                <label className="block"><span className="field-label">应用标识</span><Input value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} className="mono-data text-xs" placeholder="my-qq-bot-extension" required /></label>
                <label className="block"><span className="field-label">SDK 事件过滤（逗号分隔）</span><Input value={events} onChange={(event) => setEvents(event.target.value)} className="mono-data text-xs" required /><span className="mt-1.5 block text-[11px] leading-5 text-muted-foreground">仅过滤平台已接收事件，不修改 QQ 后台订阅或 WebSocket Intents。</span></label>
                <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-3"><Switch checked={allowQqApi} onCheckedChange={setAllowQqApi} aria-label="允许调用 QQ OpenAPI" className="mt-0.5" /><span><span className="block text-xs font-medium">允许调用 QQ OpenAPI</span><span className="mt-1 block text-[11px] leading-5 text-muted-foreground">SDK 可通过平台调用绑定机器人的官方接口，无需接触 Client Secret。</span></span></div>
                {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
                <Button type="submit" disabled={submitting || !bots.length} className="w-full">{submitting ? "正在创建..." : "创建 SDK 应用"}</Button>
              </form>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
