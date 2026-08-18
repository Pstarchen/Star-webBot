"use client";

import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import {
  ArrowUpRight,
  Boxes,
  Check,
  Clock3,
  Code2,
  Download,
  FileArchive,
  PackageCheck,
  Pencil,
  RefreshCw,
  Search,
  Save,
  Settings2,
  ShieldCheck,
  Store,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilePicker } from "@/components/ui/file-picker";
import { Input, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PluginConfigPage } from "@/components/plugin-config-page";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useTimeZone } from "@/components/time-zone-provider";
import { formatApiError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/date-time";
import type {
  Bot,
  HostedPluginConfigValue,
  HostedPluginConfigField,
  HostedPluginInstallation,
  PluginCenterData,
  PluginDeveloperProject,
  PluginMarketplaceItem,
  UserRole,
} from "@/types/platform";

type PluginsViewProps = {
  bots: Bot[];
  data: PluginCenterData;
  userRole: UserRole;
  onRefresh: () => Promise<void>;
};

type InstallTarget = { projectId: string; versionId?: string; name: string };

const statusLabels = {
  private: ["仅自己可用", "secondary"],
  pending: ["等待审核", "warning"],
  published: ["市场已上架", "success"],
  rejected: ["审核未通过", "destructive"],
  suspended: ["已停用", "destructive"],
} as const;

function formatDate(value: string | null, timeZone: string) {
  if (!value) return "尚未运行";
  return formatDateTime(value, timeZone, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function requestJson<T = unknown>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as T;
  if (!response.ok) throw new Error(formatApiError(body));
  return body;
}

function DialogHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Dialog.Title className="text-lg font-semibold text-foreground">{title}</Dialog.Title>
        <Dialog.Description className="mt-1.5 text-sm leading-6 text-muted-foreground">{description}</Dialog.Description>
      </div>
      <Dialog.Close asChild><Button variant="ghost" size="icon" className="-mr-2 -mt-2" aria-label="关闭"><X size={17} /></Button></Dialog.Close>
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  if (!message) return null;
  return <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-700">{message}</div>;
}

function ConfigField({ field, value, onChange }: { field: HostedPluginConfigField; value: unknown; onChange: (value: HostedPluginConfigValue) => void }) {
  if (field.type === "boolean") {
    return (
      <label className="flex items-start justify-between gap-4 rounded-md border bg-muted/25 px-3 py-3">
        <span className="min-w-0">
          <span className="block text-xs font-medium">{field.label}</span>
          {field.description && <span className="mt-1 block text-[11px] leading-5 text-muted-foreground">{field.description}</span>}
        </span>
        <Switch checked={Boolean(value)} onCheckedChange={onChange} aria-label={field.label} />
      </label>
    );
  }
  if (field.type === "select") {
    const options = field.options || [];
    const selected = JSON.stringify(value ?? field.default ?? options[0]?.value ?? "");
    return (
      <label className="block">
        <span className="field-label">{field.label}{field.required ? " *" : ""}</span>
        <Select
          value={selected}
          onValueChange={(next) => onChange(JSON.parse(next) as string | number | boolean)}
          options={options.map((option) => ({ value: JSON.stringify(option.value), label: option.label }))}
          ariaLabel={field.label}
        />
        {field.description && <span className="mt-1.5 block text-[11px] leading-5 text-muted-foreground">{field.description}</span>}
      </label>
    );
  }
  if (field.type === "api-list" || field.type === "reply-list") {
    return (
      <label className="block">
        <span className="field-label">{field.label}{field.required ? " *" : ""}</span>
        <Textarea
          defaultValue={JSON.stringify(value ?? field.default ?? [], null, 2)}
          onChange={(event) => {
            try {
              const parsed = JSON.parse(event.target.value) as unknown;
              if (!Array.isArray(parsed)) throw new Error("not an array");
              event.target.setCustomValidity("");
              onChange(parsed as HostedPluginConfigValue);
            } catch {
              event.target.setCustomValidity("请输入有效的 JSON 数组");
            }
          }}
          onBlur={(event) => event.currentTarget.reportValidity()}
          required={field.required}
          spellCheck={false}
          className="mono-data min-h-40 resize-y text-xs leading-5"
        />
        <span className="mt-1.5 block text-[11px] leading-5 text-muted-foreground">{field.description || "该插件未提供自定义配置页面，使用 JSON 数组备用编辑器。"}</span>
      </label>
    );
  }
  if (field.type === "textarea") {
    return (
      <label className="block">
        <span className="field-label">{field.label}{field.required ? " *" : ""}</span>
        <Textarea value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} placeholder={field.placeholder} required={field.required} className="min-h-24 resize-y" />
        {field.description && <span className="mt-1.5 block text-[11px] leading-5 text-muted-foreground">{field.description}</span>}
      </label>
    );
  }
  return (
    <label className="block">
      <span className="field-label">{field.label}{field.required ? " *" : ""}</span>
      <Input
        type={field.type === "number" ? "number" : "text"}
        value={String(value ?? "")}
        min={field.min}
        max={field.max}
        onChange={(event) => onChange(field.type === "number" ? Number(event.target.value) : event.target.value)}
        placeholder={field.placeholder}
        required={field.required}
      />
      {field.description && <span className="mt-1.5 block text-[11px] leading-5 text-muted-foreground">{field.description}</span>}
    </label>
  );
}

function MarketCard({ plugin, onDetails, onInstall, onEdit, onRemove }: {
  plugin: PluginMarketplaceItem;
  onDetails: () => void;
  onInstall: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  return (
    <Card className="flex min-h-[286px] flex-col overflow-hidden">
      <CardContent className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-foreground text-background"><Boxes size={18} /></div>
          <div className="flex items-start gap-2">
            <div className="flex flex-wrap justify-end gap-1.5">
              {plugin.featured && <Badge variant="default">精选</Badge>}
              <Badge variant="outline">{plugin.priceCents ? `¥${(plugin.priceCents / 100).toFixed(2)}` : "免费"}</Badge>
            </div>
            {onEdit && onRemove && <div className="flex shrink-0 gap-1 border-l pl-2">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} aria-label={`编辑 ${plugin.name}`} title="编辑市场信息"><Pencil size={14} /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={onRemove} aria-label={`删除 ${plugin.name}`} title="删除市场条目"><Trash2 size={14} /></Button>
            </div>}
          </div>
        </div>
        <div className="mt-5 flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-semibold">{plugin.name}</h3>
          <Badge variant="secondary" className="mono-data shrink-0">v{plugin.version}</Badge>
        </div>
        <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">{plugin.description}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">{plugin.tags.slice(0, 4).map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}</div>
        <div className="mt-auto flex items-center justify-between gap-3 border-t pt-4 text-[11px] text-muted-foreground">
          <span>{plugin.author} · {plugin.installs} 次安装</span>
          <span>{plugin.enabledBots} 个机器人启用</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={onDetails}>查看详情</Button>
          <Button size="sm" onClick={onInstall}><Download size={14} />安装</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function PluginsView({ bots, data, userRole, onRefresh }: PluginsViewProps) {
  const timeZone = useTimeZone();
  const [tab, setTab] = useState("installed");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [installTarget, setInstallTarget] = useState<InstallTarget | null>(null);
  const [installBotId, setInstallBotId] = useState(bots[0]?.id || "");
  const [installPriority, setInstallPriority] = useState("50");
  const [detailPlugin, setDetailPlugin] = useState<PluginMarketplaceItem | null>(null);
  const [configInstallation, setConfigInstallation] = useState<HostedPluginInstallation | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, HostedPluginConfigValue>>({});
  const [configPriority, setConfigPriority] = useState("50");
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewApproved, setReviewApproved] = useState(true);
  const [reviewNote, setReviewNote] = useState("");
  const [marketEdit, setMarketEdit] = useState<PluginMarketplaceItem | null>(null);
  const [marketName, setMarketName] = useState("");
  const [marketDescription, setMarketDescription] = useState("");
  const [marketAuthor, setMarketAuthor] = useState("");
  const [marketCategory, setMarketCategory] = useState("");
  const [marketTags, setMarketTags] = useState("");
  const [marketFeatured, setMarketFeatured] = useState(false);
  const [marketPriceYuan, setMarketPriceYuan] = useState("0.00");
  const [marketRemove, setMarketRemove] = useState<PluginMarketplaceItem | null>(null);
  const [marketRemoveReason, setMarketRemoveReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const categories = useMemo(() => ["all", ...new Set(data.marketplace.map((plugin) => plugin.category))], [data.marketplace]);
  const filteredMarketplace = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.marketplace.filter((plugin) => (
      (category === "all" || plugin.category === category)
      && (!query || [plugin.name, plugin.description, plugin.author, plugin.slug, ...plugin.tags].some((value) => value.toLowerCase().includes(query)))
    ));
  }, [category, data.marketplace, search]);
  const enabledCount = data.installations.filter((installation) => installation.enabled).length;
  const failedCount = data.installations.filter((installation) => installation.lastRun?.status === "failed").length;
  const tabItems = [
    { value: "installed", label: "已安装", icon: PackageCheck, count: data.installations.length },
    { value: "market", label: "插件市场", icon: Store, count: data.marketplace.length },
    { value: "projects", label: "开发者插件", icon: Code2, count: data.projects.length },
    ...(userRole === "admin" ? [{ value: "reviews", label: "待审核", icon: ShieldCheck, count: data.reviews.length }] : []),
  ];

  async function runAction(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError("");
    try { await action(); return true; }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "操作失败"); return false; }
    finally { setBusy(""); }
  }

  function openInstall(target: InstallTarget) {
    setDetailPlugin(null);
    setInstallTarget(target);
    if (!installBotId && bots[0]) setInstallBotId(bots[0].id);
    setInstallPriority("50");
    setError("");
  }

  function openConfig(installation: HostedPluginInstallation) {
    setConfigInstallation(installation);
    setConfigValues({ ...installation.config });
    setConfigPriority(String(installation.priority));
    setError("");
  }

  function openMarketEdit(plugin: PluginMarketplaceItem) {
    setMarketEdit(plugin);
    setMarketName(plugin.name);
    setMarketDescription(plugin.description);
    setMarketAuthor(plugin.author);
    setMarketCategory(plugin.category);
    setMarketTags(plugin.tags.join("，"));
    setMarketFeatured(plugin.featured);
    setMarketPriceYuan((plugin.priceCents / 100).toFixed(2));
    setError("");
  }

  async function importPackage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!importFile) return;
    await runAction("import", async () => {
      await requestJson("/api/plugin-projects/import", { method: "POST", headers: { "Content-Type": "application/zip" }, body: importFile });
      await onRefresh();
      setImportOpen(false);
      setImportFile(null);
      setTab("projects");
    });
  }

  async function install(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!installTarget || !installBotId) return;
    await runAction("install", async () => {
      await requestJson("/api/plugin-installations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: installTarget.projectId, versionId: installTarget.versionId, botId: installBotId, priority: Number(installPriority) }),
      });
      await onRefresh();
      setInstallTarget(null);
      setDetailPlugin(null);
      setTab("installed");
    });
  }

  async function updateInstallation(installationId: string, body: Record<string, unknown>, key: string) {
    return runAction(key, async () => {
      await requestJson(`/api/plugin-installations/${installationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await onRefresh();
    });
  }

  async function saveConfig(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configInstallation) return;
    const saved = await updateInstallation(configInstallation.id, { config: configValues, priority: Number(configPriority) }, `config:${configInstallation.id}`);
    if (saved) setConfigInstallation(null);
  }

  async function savePriority() {
    if (!configInstallation) return;
    const priority = Number(configPriority);
    if (!Number.isInteger(priority) || priority < 1 || priority > 100) {
      setError("执行优先级必须是 1 到 100 的整数");
      return;
    }
    const saved = await updateInstallation(configInstallation.id, { priority }, `priority:${configInstallation.id}`);
    if (saved) setConfigInstallation((current) => current ? { ...current, priority } : current);
  }

  async function uninstall(installation: HostedPluginInstallation) {
    if (!window.confirm(`确定从 ${installation.botName} 卸载 ${installation.name} 吗？插件配置、KV 数据和运行记录将一并删除。`)) return;
    await runAction(`delete:${installation.id}`, async () => {
      await requestJson(`/api/plugin-installations/${installation.id}`, { method: "DELETE" });
      await onRefresh();
    });
  }

  async function updateInstallationVersion(installation: HostedPluginInstallation) {
    if (!installation.latestVersionId || installation.latestVersionId === installation.versionId) return;
    await updateInstallation(installation.id, { versionId: installation.latestVersionId }, `version:${installation.id}`);
  }

  async function requestReview(project: PluginDeveloperProject) {
    const latestVersion = project.versions[0];
    if (!latestVersion) return;
    await runAction(`review:${project.id}`, async () => {
      await requestJson(`/api/plugin-projects/${project.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: latestVersion.id }),
      });
      await onRefresh();
    });
  }

  async function submitReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reviewId) return;
    await runAction(`admin-review:${reviewId}`, async () => {
      await requestJson(`/api/plugin-reviews/${reviewId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: reviewApproved, note: reviewNote }),
      });
      await onRefresh();
      setReviewId(null);
      setReviewNote("");
    });
  }

  async function saveMarketplace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!marketEdit) return;
    const saved = await runAction(`market-edit:${marketEdit.id}`, async () => {
      await requestJson(`/api/plugin-marketplace/${marketEdit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: marketName,
          description: marketDescription,
          author: marketAuthor,
          category: marketCategory,
          tags: marketTags.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean),
          featured: marketFeatured,
          priceCents: Math.round(Number(marketPriceYuan) * 100),
        }),
      });
      await onRefresh();
    });
    if (saved) setMarketEdit(null);
  }

  async function removeFromMarketplace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!marketRemove) return;
    const removed = await runAction(`market-remove:${marketRemove.id}`, async () => {
      await requestJson(`/api/plugin-marketplace/${marketRemove.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: marketRemoveReason || undefined }),
      });
      await onRefresh();
    });
    if (removed) {
      if (detailPlugin?.id === marketRemove.id) setDetailPlugin(null);
      setMarketRemove(null);
      setMarketRemoveReason("");
    }
  }

  return (
    <div>
      <PageHeader
        title="插件中心"
        description="安装平台托管插件，为每个机器人独立配置和控制运行状态。"
        action={<Button onClick={() => { setError(""); setImportOpen(true); }}><Upload size={15} />导入插件包</Button>}
      />

      <div className="mb-5 grid border bg-card sm:grid-cols-3">
        {[["已安装", data.installations.length], ["正在运行", enabledCount], ["运行异常", failedCount]].map(([label, value], index) => (
          <div key={label} className={`flex items-center justify-between px-5 py-4 ${index ? "border-t sm:border-l sm:border-t-0" : ""}`}>
            <span className="text-xs text-muted-foreground">{label}</span><span className="mono-data text-xl font-semibold">{value}</span>
          </div>
        ))}
      </div>

      {error && <div className="mb-5 flex items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700"><span>{error}</span><button onClick={() => setError("")} aria-label="关闭错误"><X size={14} /></button></div>}

      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List className="mb-5 flex w-full gap-1 overflow-x-auto border-b" aria-label="插件中心视图">
          {tabItems.map(({ value, label, icon: Icon, count }) => (
            <Tabs.Trigger key={value} value={value} className="flex h-10 shrink-0 items-center gap-2 border-b-2 border-transparent px-3 text-xs font-medium text-muted-foreground outline-none data-[state=active]:border-foreground data-[state=active]:text-foreground"><Icon size={14} />{label}<span className="mono-data text-[10px]">{count}</span></Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="installed" className="outline-none">
          {data.installations.length ? (
            <Card className="overflow-hidden">
              <div className="divide-y">
                {data.installations.map((installation) => (
                  <div key={installation.id} className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_180px_minmax(190px,320px)] lg:items-center">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted"><Boxes size={16} /></div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{installation.name}</h3><Badge variant="outline" className="mono-data">v{installation.version}</Badge><Badge variant={installation.enabled ? "success" : installation.projectStatus === "suspended" ? "destructive" : "secondary"}>{installation.enabled ? "运行中" : installation.projectStatus === "suspended" ? "市场已下架" : "已停用"}</Badge></div>
                        <p className="mt-1.5 line-clamp-1 text-xs text-muted-foreground">{installation.description}</p>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground"><span>{installation.botName}</span><span>优先级 {installation.priority}</span><span>{installation.events.length} 个事件</span></div>
                      </div>
                    </div>
                    <div className="min-w-0 text-[11px]">
                      <div className="flex items-center gap-2 text-muted-foreground"><Clock3 size={13} />{formatDate(installation.lastRunAt, timeZone)}</div>
                      {installation.lastRun && <div className={`mt-1.5 truncate ${installation.lastRun.status === "failed" ? "text-red-600" : "text-muted-foreground"}`}>{installation.lastRun.status === "failed" ? installation.lastRun.error : `${installation.lastRun.durationMs}ms · ${installation.lastRun.actionCount} 个动作`}</div>}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 lg:justify-end">
                      <Switch checked={installation.enabled} disabled={installation.projectStatus === "suspended" || busy === `toggle:${installation.id}`} onCheckedChange={(enabled) => void updateInstallation(installation.id, { enabled }, `toggle:${installation.id}`)} aria-label={installation.projectStatus === "suspended" ? "插件已被管理员下架" : installation.enabled ? "停用插件" : "启用插件"} />
                      {installation.latestVersionId && installation.latestVersionId !== installation.versionId && <Button variant="outline" size="sm" onClick={() => void updateInstallationVersion(installation)} disabled={busy === `version:${installation.id}`}><RefreshCw size={14} />{busy === `version:${installation.id}` ? "更新中..." : `更新到 v${installation.latestVersion || "最新版本"}`}</Button>}
                      <Button variant="outline" size="sm" onClick={() => openConfig(installation)}><Settings2 size={14} />配置</Button>
                      <Button variant="ghost" size="icon" disabled={busy === `delete:${installation.id}`} onClick={() => void uninstall(installation)} aria-label="卸载插件"><Trash2 size={15} /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <Card><EmptyState icon={PackageCheck} title="还没有安装插件" description={bots.length ? "从插件市场选择插件并绑定到机器人。" : "添加机器人后即可安装插件。"} action={bots.length ? <Button size="sm" onClick={() => setTab("market")}><Store size={14} />打开插件市场</Button> : undefined} /></Card>
          )}
        </Tabs.Content>

        <Tabs.Content value="market" className="outline-none">
          <div className="mb-5 flex flex-col gap-3 border-b pb-5 sm:flex-row">
            <label className="relative min-w-0 flex-1"><Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索插件、作者或标签" className="pl-9" /></label>
            <Select value={category} onValueChange={setCategory} options={categories.map((value) => ({ value, label: value === "all" ? "全部分类" : value }))} ariaLabel="筛选插件分类" className="sm:w-44" />
          </div>
          {filteredMarketplace.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filteredMarketplace.map((plugin) => <MarketCard key={plugin.id} plugin={plugin} onDetails={() => setDetailPlugin(plugin)} onInstall={() => openInstall({ projectId: plugin.id, versionId: plugin.versionId, name: plugin.name })} onEdit={userRole === "admin" ? () => openMarketEdit(plugin) : undefined} onRemove={userRole === "admin" ? () => { setMarketRemove(plugin); setMarketRemoveReason(""); setError(""); } : undefined} />)}</div>
          ) : (
            <Card><EmptyState icon={Search} title="没有匹配的插件" description="调整搜索词或分类后重试。" /></Card>
          )}
        </Tabs.Content>

        <Tabs.Content value="projects" className="outline-none">
          <div className="mb-4 flex items-center justify-between gap-4"><div><h2 className="text-sm font-semibold">我的插件项目</h2><p className="mt-1 text-xs text-muted-foreground">导入后可直接安装到自己的机器人，申请审核后进入市场。</p></div><Button variant="outline" size="sm" onClick={() => { setError(""); setImportOpen(true); }}><Upload size={14} />导入版本</Button></div>
          {data.projects.length ? (
            <Card className="overflow-hidden"><div className="divide-y">{data.projects.map((project) => {
              const status = statusLabels[project.status];
              const latest = project.versions[0];
              const latestPending = Boolean(latest && project.pendingVersionId === latest.id);
              return (
                <div key={project.id} className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_170px_220px] lg:items-center">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{project.name}</h3><Badge variant={status[1]}>{status[0]}</Badge>{latest && <Badge variant="outline" className="mono-data">v{latest.version}</Badge>}</div><p className="mt-1.5 line-clamp-1 text-xs text-muted-foreground">{project.description}</p>{project.reviewNote && <p className="mt-2 text-[11px] text-red-600">{project.reviewNote}</p>}</div>
                  <div className="text-[11px] text-muted-foreground"><div>{project.versions.length} 个版本</div><div className="mt-1">{project.installs} 次安装 · {project.enabledBots} 个启用</div></div>
                  <div className="flex flex-wrap justify-start gap-2 lg:justify-end"><Button variant="outline" size="sm" disabled={!latest || project.status === "suspended"} onClick={() => openInstall({ projectId: project.id, versionId: latest?.id, name: project.name })}><Download size={14} />私有安装</Button><Button size="sm" disabled={!latest || latestPending || project.status === "suspended" || busy === `review:${project.id}`} onClick={() => void requestReview(project)}><ArrowUpRight size={14} />{latestPending ? "审核中" : project.status === "published" ? "发布新版" : "申请上架"}</Button></div>
                </div>
              );
            })}</div></Card>
          ) : (
            <Card><EmptyState icon={FileArchive} title="还没有插件项目" description="导入符合 StarBot 清单规范的 ZIP 插件包。" action={<Button size="sm" onClick={() => { setError(""); setImportOpen(true); }}><Upload size={14} />导入插件包</Button>} /></Card>
          )}
        </Tabs.Content>

        {userRole === "admin" && <Tabs.Content value="reviews" className="outline-none">
          {data.reviews.length ? <Card className="overflow-hidden"><div className="divide-y">{data.reviews.map((review) => <div key={review.id} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{review.projectName}</h3><Badge variant="warning">等待审核</Badge><Badge variant="outline" className="mono-data">v{review.version}</Badge></div><p className="mt-1.5 text-xs text-muted-foreground">提交人 {review.authorName} · {formatDate(review.requestedAt, timeZone)}</p></div><Button size="sm" onClick={() => { setReviewId(review.id); setReviewApproved(true); setReviewNote(""); }}><ShieldCheck size={14} />开始审核</Button></div>)}</div></Card> : <Card><EmptyState icon={Check} title="没有待审核插件" description="新的市场申请会显示在这里。" /></Card>}
        </Tabs.Content>}
      </Tabs.Root>

      <Dialog.Root open={importOpen} onOpenChange={setImportOpen}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" /><Dialog.Content className="modal-panel fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-card p-5 shadow-2xl outline-none sm:p-6"><DialogHeader title="导入插件包" description="上传由 StarBot 插件 SDK 构建的 ZIP 包，导入后仅当前账号可用。" /><form onSubmit={importPackage} className="mt-5 space-y-4"><div><span className="field-label">插件包</span><FilePicker file={importFile} onFileChange={setImportFile} accept=".zip,application/zip" browseLabel="选择 ZIP" emptyLabel="尚未选择插件包" helperText="ZIP 格式，最大 2MB" disabled={busy === "import"} /></div><div className="border bg-muted/30 px-3 py-3 text-[11px] leading-5 text-muted-foreground"><div className="flex items-center gap-2 font-medium text-foreground"><FileArchive size={14} />导入前自动安全校验</div><div className="mt-1">插件包必须包含 starbot.plugin.json 和清单指定的 JavaScript 入口文件。</div></div><InlineError message={error} /><Button type="submit" className="w-full" disabled={!importFile || busy === "import"}><Upload size={14} />{busy === "import" ? "正在校验..." : "导入并创建版本"}</Button></form></Dialog.Content></Dialog.Portal></Dialog.Root>

      <Dialog.Root open={Boolean(installTarget)} onOpenChange={(open) => !open && setInstallTarget(null)}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" /><Dialog.Content className="modal-panel fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-card p-5 shadow-2xl outline-none sm:p-6"><DialogHeader title={`安装 ${installTarget?.name || "插件"}`} description="选择运行该插件的机器人，安装后可完成配置再启用。" /><form onSubmit={install} className="mt-5 space-y-4"><label className="block"><span className="field-label">机器人</span><Select value={installBotId} onValueChange={setInstallBotId} options={bots.map((bot) => ({ value: bot.id, label: bot.name }))} placeholder="请选择机器人" ariaLabel="选择安装机器人" /></label><label className="block"><span className="field-label">执行优先级</span><Input type="number" min={1} max={100} value={installPriority} onChange={(event) => setInstallPriority(event.target.value)} required /><span className="mt-1.5 block text-[11px] text-muted-foreground">数值越小越先处理事件。</span></label>{!bots.length && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">请先添加机器人。</div>}<InlineError message={error} /><Button type="submit" className="w-full" disabled={!bots.length || !installBotId || busy === "install"}><Download size={14} />{busy === "install" ? "正在安装..." : "安装到机器人"}</Button></form></Dialog.Content></Dialog.Portal></Dialog.Root>

      <Dialog.Root open={Boolean(configInstallation)} onOpenChange={(open) => !open && setConfigInstallation(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
          <Dialog.Content className={`modal-panel fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-32px)] w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-card p-5 shadow-2xl outline-none sm:p-6 ${configInstallation?.configPage ? "max-w-6xl" : "max-w-lg"}`}>
            <DialogHeader title={`配置 ${configInstallation?.name || "插件"}`} description={`${configInstallation?.botName || "机器人"} · 配置保存后立即用于下一次事件。`} />
            {configInstallation?.configPage ? (
              <div className="mt-5 space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
                  <label className="block w-40">
                    <span className="field-label">执行优先级</span>
                    <Input type="number" min={1} max={100} value={configPriority} onChange={(event) => setConfigPriority(event.target.value)} required />
                  </label>
                  <Button type="button" variant="outline" size="sm" onClick={() => void savePriority()} disabled={busy === `priority:${configInstallation.id}`}>
                    <Save size={14} />保存优先级
                  </Button>
                </div>
                <PluginConfigPage
                  installation={configInstallation}
                  config={configValues}
                  onConfigSaved={async (nextConfig) => {
                    setConfigValues(nextConfig);
                    await onRefresh();
                  }}
                  onError={setError}
                />
                <InlineError message={error} />
              </div>
            ) : (
              <form onSubmit={saveConfig} className="mt-5 space-y-4">
                <label className="block sm:max-w-52">
                  <span className="field-label">执行优先级</span>
                  <Input type="number" min={1} max={100} value={configPriority} onChange={(event) => setConfigPriority(event.target.value)} required />
                </label>
                {configInstallation?.configSchema.map((field) => <ConfigField key={field.key} field={field} value={configValues[field.key] ?? field.default} onChange={(value) => setConfigValues((current) => ({ ...current, [field.key]: value }))} />)}
                {configInstallation?.configSchema.length === 0 && <div className="border bg-muted/30 px-3 py-4 text-xs text-muted-foreground">该插件没有可配置项。</div>}
                <InlineError message={error} />
                <Button type="submit" className="w-full" disabled={busy === `config:${configInstallation?.id}`}><Settings2 size={14} />保存配置</Button>
              </form>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(detailPlugin)} onOpenChange={(open) => !open && setDetailPlugin(null)}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" /><Dialog.Content className="modal-panel fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-32px)] w-[calc(100%-32px)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-card p-5 shadow-2xl outline-none sm:p-6"><DialogHeader title={detailPlugin?.name || "插件详情"} description={`${detailPlugin?.author || ""} · ${detailPlugin?.category || ""} · v${detailPlugin?.version || ""}`} />{detailPlugin && <div className="mt-5 space-y-5"><p className="text-sm leading-6 text-muted-foreground">{detailPlugin.description}</p><div><div className="data-label">事件与权限</div><div className="mt-2 flex flex-wrap gap-1.5">{[...detailPlugin.events, ...detailPlugin.permissions].map((item) => <Badge key={item} variant="secondary" className="mono-data">{item}</Badge>)}</div></div>{detailPlugin.commands.length > 0 && <div><div className="data-label">使用指令</div><div className="mt-2 divide-y border">{detailPlugin.commands.map((command) => <div key={command.name} className="flex items-start justify-between gap-4 px-3 py-3 text-xs"><span className="font-medium">{command.name}</span><span className="text-right text-muted-foreground">{command.description}</span></div>)}</div></div>}<Button className="w-full" onClick={() => openInstall({ projectId: detailPlugin.id, versionId: detailPlugin.versionId, name: detailPlugin.name })}><Download size={14} />安装到机器人</Button></div>}</Dialog.Content></Dialog.Portal></Dialog.Root>

      <Dialog.Root open={Boolean(marketEdit)} onOpenChange={(open) => !open && setMarketEdit(null)}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" /><Dialog.Content className="modal-panel fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-32px)] w-[calc(100%-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-card p-5 shadow-2xl outline-none sm:p-6"><DialogHeader title="编辑市场插件" description="修改市场展示与定价，不会更改已审核的插件代码、权限或版本哈希。" /><form onSubmit={saveMarketplace} className="mt-5 space-y-4"><label className="block"><span className="field-label">插件名称</span><Input value={marketName} onChange={(event) => setMarketName(event.target.value)} maxLength={80} required /></label><label className="block"><span className="field-label">市场说明</span><Textarea value={marketDescription} onChange={(event) => setMarketDescription(event.target.value)} maxLength={500} required className="min-h-28 resize-y" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block"><span className="field-label">作者</span><Input value={marketAuthor} onChange={(event) => setMarketAuthor(event.target.value)} maxLength={80} required /></label><label className="block"><span className="field-label">分类</span><Input value={marketCategory} onChange={(event) => setMarketCategory(event.target.value)} maxLength={40} required /></label></div><div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]"><label className="block"><span className="field-label">标签</span><Input value={marketTags} onChange={(event) => setMarketTags(event.target.value)} placeholder="多个标签使用逗号分隔" /><span className="mt-1.5 block text-[11px] text-muted-foreground">最多 8 个标签，每个标签不超过 24 个字符。</span></label><label className="block"><span className="field-label">价格（元）</span><Input type="number" min={0} max={1_000_000} step="0.01" value={marketPriceYuan} onChange={(event) => setMarketPriceYuan(event.target.value)} required /></label></div><label className="flex items-center justify-between gap-4 border bg-muted/25 px-3 py-3"><span><span className="block text-xs font-medium">精选推荐</span><span className="mt-1 block text-[11px] text-muted-foreground">精选插件优先显示在市场列表。</span></span><Switch checked={marketFeatured} onCheckedChange={setMarketFeatured} aria-label="设置为精选插件" /></label><InlineError message={error} /><Button type="submit" className="w-full" disabled={busy === `market-edit:${marketEdit?.id}`}><Pencil size={14} />{busy === `market-edit:${marketEdit?.id}` ? "正在保存..." : "保存市场信息"}</Button></form></Dialog.Content></Dialog.Portal></Dialog.Root>

      <Dialog.Root open={Boolean(marketRemove)} onOpenChange={(open) => !open && setMarketRemove(null)}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" /><Dialog.Content className="modal-panel fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-card p-5 shadow-2xl outline-none sm:p-6"><DialogHeader title="删除插件市场条目" description={`删除 ${marketRemove?.name || "该插件"} 的市场条目后，所有正在运行的安装实例会立即停用。`} /><form onSubmit={removeFromMarketplace} className="mt-5 space-y-4"><div className="border border-red-200 bg-red-50 px-3 py-3 text-xs leading-5 text-red-700">市场条目会被删除；插件项目、版本、安装配置和运行历史保留，普通用户不能继续安装或启用。</div><label className="block"><span className="field-label">删除原因</span><Textarea value={marketRemoveReason} onChange={(event) => setMarketRemoveReason(event.target.value)} maxLength={500} placeholder="可选，将记录到项目和审计日志" className="min-h-24 resize-y" /></label><InlineError message={error} /><Button type="submit" variant="destructive" className="w-full" disabled={busy === `market-remove:${marketRemove?.id}`}><Trash2 size={14} />{busy === `market-remove:${marketRemove?.id}` ? "正在删除..." : "确认删除市场条目"}</Button></form></Dialog.Content></Dialog.Portal></Dialog.Root>

      <Dialog.Root open={Boolean(reviewId)} onOpenChange={(open) => !open && setReviewId(null)}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" /><Dialog.Content className="modal-panel fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-card p-5 shadow-2xl outline-none sm:p-6"><DialogHeader title="插件市场审核" description="审核结论会更新项目状态；通过后对应版本立即进入市场。" /><form onSubmit={submitReview} className="mt-5 space-y-4"><div className="grid grid-cols-2 gap-2"><Button type="button" variant={reviewApproved ? "default" : "outline"} onClick={() => setReviewApproved(true)}><Check size={14} />通过</Button><Button type="button" variant={!reviewApproved ? "destructive" : "outline"} onClick={() => setReviewApproved(false)}><X size={14} />驳回</Button></div><label className="block"><span className="field-label">审核备注{!reviewApproved ? " *" : ""}</span><Textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} required={!reviewApproved} className="min-h-28 resize-y" /></label><InlineError message={error} /><Button type="submit" className="w-full" disabled={busy.startsWith("admin-review:")}><ShieldCheck size={14} />提交审核结论</Button></form></Dialog.Content></Dialog.Portal></Dialog.Root>
    </div>
  );
}
