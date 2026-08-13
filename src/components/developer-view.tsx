"use client";

import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import {
  BookOpen,
  Box,
  Check,
  Code2,
  Copy,
  Database,
  Download,
  FileJson2,
  FileUp,
  MessageSquareReply,
  PackageCheck,
  Play,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FilePicker } from "@/components/ui/file-picker";
import { Input, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { QQ_OPENAPI_ENDPOINTS, type QQOpenApiEndpointId } from "@/lib/qq-openapi-catalog";
import { cn } from "@/lib/utils";
import type { Bot } from "@/types/platform";

const pluginCode = `StarBot.definePlugin({
  async onEvent(event, sdk) {
    const content = String(event.data?.content || "").trim();
    if (content !== sdk.config.keyword) return;

    const profile = await sdk.qq.getBotProfile();
    const count = sdk.kv.get("triggerCount", 0) + 1;
    sdk.kv.set("triggerCount", count);
    sdk.reply.text(\`${"${profile.body.username}"}：${"${sdk.config.reply}"}\\n已触发 ${"${count}"} 次。\`);
    sdk.log.info("keyword matched", { count });
  },
});`;

const manifestCode = `{
  "schemaVersion": 1,
  "id": "keyword-reply",
  "name": "关键词回复",
  "version": "1.0.0",
  "description": "收到指定关键词时自动回复，并记录累计触发次数。",
  "author": "Your Name",
  "category": "消息互动",
  "tags": ["自动回复"],
  "entry": "index.js",
  "events": ["C2C_MESSAGE_CREATE"],
  "permissions": ["reply:text", "qq:api", "storage:kv", "log:write"],
  "configSchema": [
    { "key": "keyword", "label": "关键词", "type": "text", "required": true, "default": "你好" },
    { "key": "reply", "label": "回复内容", "type": "text", "required": true, "default": "你好，消息已收到。" }
  ]
}`;

const workflow = [
  ["01", "编写", "注册事件处理器并按需等待 QQ OpenAPI"],
  ["02", "构建", "运行 SDK 构建命令生成可校验 ZIP"],
  ["03", "安装", "导入插件中心并绑定机器人后启用"],
];

function readableErrorDetail(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (!value || typeof value !== "object") return "";
  const detail = value as Record<string, unknown>;
  const code = typeof detail.code === "string" || typeof detail.code === "number" ? `错误码 ${detail.code}` : "";
  const message = typeof detail.message === "string" ? detail.message : typeof detail.msg === "string" ? detail.msg : "";
  return [code, message].filter(Boolean).join(" · ");
}

const capabilities = [
  [MessageSquareReply, "回复消息", "文本、Markdown、Ark 与键盘"],
  [Database, "保存状态", "按安装实例隔离的 KV 存储"],
  [Code2, "调用 QQ API", "34 个官方端点与通用请求均返回响应"],
  [ShieldCheck, "隔离执行", "QuickJS 沙箱、超时和动作数量限制"],
];

const officialEndpointOptions = [
  { value: "custom", label: "自定义相对路径" },
  ...Object.entries(QQ_OPENAPI_ENDPOINTS).map(([id, endpoint]) => ({ value: id, label: `${endpoint.method} · ${endpoint.title}` })),
];

export function DeveloperView({ bots }: { bots: Bot[] }) {
  const [copied, setCopied] = useState<"code" | "manifest" | "">("");
  const [botId, setBotId] = useState(bots[0]?.id || "");
  const [sendMode, setSendMode] = useState<"reply" | "proactive">("reply");
  const [targetType, setTargetType] = useState<"c2c" | "group">("c2c");
  const [targetOpenid, setTargetOpenid] = useState("");
  const [content, setContent] = useState("你好，这是一条来自 StarBot 调试台的消息。");
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [apiMethod, setApiMethod] = useState<"GET" | "POST" | "PUT" | "PATCH" | "DELETE">("GET");
  const [apiPath, setApiPath] = useState("/gateway/bot");
  const [apiEndpointId, setApiEndpointId] = useState("custom");
  const [apiBody, setApiBody] = useState("{}");
  const [apiResult, setApiResult] = useState<unknown>(null);
  const [apiError, setApiError] = useState("");
  const [apiSending, setApiSending] = useState(false);
  const [mediaTargetType, setMediaTargetType] = useState<"c2c" | "group">("c2c");
  const [mediaTargetOpenid, setMediaTargetOpenid] = useState("");
  const [mediaFileType, setMediaFileType] = useState<"1" | "2" | "3" | "4">("1");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaSendDirectly, setMediaSendDirectly] = useState(false);
  const [mediaSending, setMediaSending] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [mediaResult, setMediaResult] = useState<unknown>(null);

  function selectOfficialEndpoint(value: string) {
    setApiEndpointId(value);
    if (value === "custom") return;
    const endpoint = QQ_OPENAPI_ENDPOINTS[value as QQOpenApiEndpointId];
    setApiMethod(endpoint.method);
    setApiPath(endpoint.path);
  }
  async function copySnippet(kind: "code" | "manifest", value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(""), 1400);
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!botId) return;
    setSending(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/bots/" + botId + "/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sendMode, targetType, targetOpenid, content }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const failure = body as { message?: string; code?: string; traceId?: string };
        const metadata = [failure.code ? `错误码 ${failure.code}` : "", failure.traceId ? `Trace ${failure.traceId}` : ""].filter(Boolean).join(" · ");
        throw new Error((failure.message || "发送失败") + (metadata ? `\n${metadata}` : ""));
      }
      setResult(body);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "发送失败");
    } finally {
      setSending(false);
    }
  }

  async function callOpenApi(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!botId) return;
    setApiSending(true);
    setApiError("");
    setApiResult(null);
    try {
      const body = apiMethod === "GET" ? undefined : JSON.parse(apiBody);
      const response = await fetch("/api/bots/" + botId + "/openapi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: apiMethod, path: apiPath, body }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error((result as { message?: string }).message || "OpenAPI 请求失败");
      setApiResult(result);
    } catch (requestError) {
      setApiError(requestError instanceof SyntaxError ? "请求体不是有效 JSON" : requestError instanceof Error ? requestError.message : "OpenAPI 请求失败");
    } finally {
      setApiSending(false);
    }
  }

  async function uploadMedia(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!botId || !mediaFile) return;
    setMediaSending(true);
    setMediaError("");
    setMediaResult(null);
    try {
      const formData = new FormData();
      formData.set("targetType", mediaTargetType);
      formData.set("targetOpenid", mediaTargetOpenid);
      formData.set("fileType", mediaFileType);
      formData.set("srvSendMsg", String(mediaSendDirectly));
      formData.set("file", mediaFile);
      const response = await fetch("/api/bots/" + botId + "/media", { method: "POST", body: formData });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const failure = body as { message?: string; code?: string | number; traceId?: string; detail?: unknown };
        throw new Error([
          failure.message,
          failure.code !== undefined && failure.code !== null ? `错误码 ${failure.code}` : "",
          readableErrorDetail(failure.detail),
          failure.traceId ? "Trace " + failure.traceId : "",
        ].filter(Boolean).join(" · ") || "富媒体上传失败");
      }
      setMediaResult(body);
    } catch (requestError) {
      setMediaError(requestError instanceof Error ? requestError.message : "富媒体上传失败");
    } finally {
      setMediaSending(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="开发者中心"
        description="开发托管插件，并使用机器人凭据调试 QQ Bot API v2。"
        action={(
          <div className="flex flex-wrap gap-2">
            <a href="/downloads/daily-checkin-demo.zip" download className={cn(buttonVariants({ variant: "default" }))}>
              <Download size={15} />下载测试插件
            </a>
            <a href="https://bot.q.qq.com/wiki/develop/api-v2/" target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline" }))}>
              <BookOpen size={15} />QQ 官方文档
            </a>
          </div>
        )}
      />

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="border-b sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">托管插件 SDK</CardTitle>
              <Badge variant="success">运行时已接入</Badge>
              <Badge variant="outline">SDK 1.0</Badge>
            </div>
            <CardDescription>插件随 QQ 事件在平台沙箱内执行，不需要自建 Webhook 服务。</CardDescription>
          </div>
          <div className="mono-data mt-2 rounded-md border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground sm:mt-0">
            node sdk/plugin/build.mjs ./my-plugin ./dist/plugin.zip
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
            <div className="min-w-0 p-4 sm:p-5">
              <Tabs.Root defaultValue="code">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <Tabs.List className="flex rounded-md bg-muted p-1" aria-label="插件示例文件">
                    <Tabs.Trigger value="code" className="flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-[11px] font-medium text-muted-foreground outline-none data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><Box size={13} />index.js</Tabs.Trigger>
                    <Tabs.Trigger value="manifest" className="flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-[11px] font-medium text-muted-foreground outline-none data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><FileJson2 size={13} />starbot.plugin.json</Tabs.Trigger>
                  </Tabs.List>
                </div>
                <Tabs.Content value="code" className="relative outline-none">
                  <Button variant="secondary" size="sm" className="absolute right-3 top-3 z-10" onClick={() => void copySnippet("code", pluginCode)}>
                    {copied === "code" ? <Check size={13} /> : <Copy size={13} />}{copied === "code" ? "已复制" : "复制"}
                  </Button>
                  <pre className="mono-data max-h-[330px] overflow-auto rounded-md bg-zinc-950 p-4 pr-24 text-[11px] leading-6 text-zinc-200">{pluginCode}</pre>
                </Tabs.Content>
                <Tabs.Content value="manifest" className="relative outline-none">
                  <Button variant="secondary" size="sm" className="absolute right-3 top-3 z-10" onClick={() => void copySnippet("manifest", manifestCode)}>
                    {copied === "manifest" ? <Check size={13} /> : <Copy size={13} />}{copied === "manifest" ? "已复制" : "复制"}
                  </Button>
                  <pre className="mono-data max-h-[330px] overflow-auto rounded-md bg-zinc-950 p-4 pr-24 text-[11px] leading-6 text-zinc-200">{manifestCode}</pre>
                </Tabs.Content>
              </Tabs.Root>

              <div className="mt-4 grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-3">
                {workflow.map(([step, title, description]) => (
                  <div key={step} className="bg-card p-3.5">
                    <div className="mono-data text-[10px] text-muted-foreground">STEP {step}</div>
                    <div className="mt-1.5 text-xs font-semibold">{title}</div>
                    <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t bg-muted/20 p-4 sm:p-5 lg:border-l lg:border-t-0">
              <div className="text-xs font-semibold">SDK 可用能力</div>
              <div className="mt-3 divide-y rounded-md border bg-card">
                {capabilities.map(([Icon, title, description]) => (
                  <div key={String(title)} className="flex items-start gap-3 p-3.5">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted"><Icon size={15} /></div>
                    <div className="min-w-0"><div className="text-xs font-medium">{String(title)}</div><div className="mt-1 text-[11px] leading-4 text-muted-foreground">{String(description)}</div></div>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-md border border-dashed bg-card p-4">
                <div className="flex items-center gap-2 text-xs font-semibold"><PackageCheck size={15} />每日签到助手</div>
                <p className="mt-2 text-[11px] leading-5 text-muted-foreground">用于验证指令回复、配置项、用户签到记录和运行日志。下载后前往插件中心直接导入。</p>
                <a href="/downloads/daily-checkin-demo.zip" download className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3 w-full")}>
                  <Download size={14} />下载可导入 ZIP
                </a>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(340px,0.8fr)_minmax(0,1.2fr)]">
        <Card className="min-w-0">
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle>消息调试</CardTitle>
              <CardDescription>默认复用最近收到的消息上下文，避免误走主动消息权限</CardDescription>
            </div>
            <Badge variant="success">OpenAPI</Badge>
          </CardHeader>
          <CardContent>
            <form onSubmit={sendMessage} className="space-y-4">
              <label className="block">
                <span className="field-label">机器人</span>
                <Select
                  value={botId}
                  onValueChange={setBotId}
                  options={bots.map((bot) => ({ value: bot.id, label: `${bot.name} · ${bot.environment === "production" ? "正式使用" : "测试使用"}` }))}
                  placeholder="请选择机器人"
                  ariaLabel="选择机器人"
                />
              </label>
              <label className="block">
                <span className="field-label">发送模式</span>
                <Select
                  value={sendMode}
                  onValueChange={(value) => setSendMode(value as "reply" | "proactive")}
                  options={[{ value: "reply", label: "回复最近事件" }, { value: "proactive", label: "主动发送" }]}
                  ariaLabel="选择发送模式"
                />
                <span className="mt-1.5 block text-[11px] leading-5 text-muted-foreground">
                  {sendMode === "reply" ? "群聊使用 5 分钟内、单聊使用 60 分钟内的最近消息。" : "需要机器人已获得 QQ 主动消息权限。"}
                </span>
              </label>
              <label className="block">
                <span className="field-label">消息场景</span>
                <Select value={targetType} onValueChange={(value) => setTargetType(value as "c2c" | "group")} options={[{ value: "c2c", label: "单聊用户" }, { value: "group", label: "群聊" }]} ariaLabel="选择消息场景" />
              </label>
              <label className="block"><span className="field-label">目标 OpenID</span><Input value={targetOpenid} onChange={(event) => setTargetOpenid(event.target.value)} className="mono-data text-xs" required /></label>
              <label className="block"><span className="field-label">消息内容</span><Textarea value={content} onChange={(event) => setContent(event.target.value)} className="resize-none text-xs" required /></label>
              {error && <div className="whitespace-pre-line rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700">{error}</div>}
              <Button type="submit" disabled={sending || !bots.length} className="w-full"><Play size={14} />{sending ? "正在发送..." : "调用 QQ 消息接口"}</Button>
            </form>

            {result !== null && (
              <div className="mt-5 border-t pt-5">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700"><TerminalSquare size={14} />请求成功</div>
                <pre className="mono-data mt-3 max-h-56 max-w-full overflow-auto rounded-md bg-zinc-950 p-4 text-[10px] leading-5 text-zinc-200">{JSON.stringify(result, null, 2)}</pre>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>OpenAPI 请求台</CardTitle>
            <CardDescription>按 QQ 官方文档填写相对路径，可调用机器人有权限访问的 REST API。</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={callOpenApi} className="grid gap-4 lg:grid-cols-[130px_minmax(0,1fr)]">
              <label className="block lg:col-span-2"><span className="field-label">官方端点</span><Select value={apiEndpointId} onValueChange={selectOfficialEndpoint} options={officialEndpointOptions} ariaLabel="选择 QQ 官方端点" /></label>
              <label className="block"><span className="field-label">HTTP 方法</span><Select value={apiMethod} onValueChange={(value) => setApiMethod(value as typeof apiMethod)} options={["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => ({ value: method, label: method }))} ariaLabel="选择 HTTP 方法" className="mono-data" /></label>
              <label className="block"><span className="field-label">官方 API 相对路径</span><Input value={apiPath} onChange={(event) => { setApiPath(event.target.value); setApiEndpointId("custom"); }} className="mono-data text-xs" placeholder="/v2/users/{openid}/messages" required /></label>
              <label className="block lg:col-span-2"><span className="field-label">JSON 请求体</span><Textarea value={apiBody} onChange={(event) => setApiBody(event.target.value)} disabled={apiMethod === "GET"} className="mono-data min-h-36 resize-y text-xs" /></label>
              {apiError && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 lg:col-span-2">{apiError}</div>}
              <div className="lg:col-span-2"><Button type="submit" disabled={apiSending || !bots.length}><Play size={14} />{apiSending ? "正在请求..." : "发送 OpenAPI 请求"}</Button></div>
            </form>
            {apiResult !== null && <pre className="mono-data mt-5 max-h-80 max-w-full overflow-auto rounded-md bg-zinc-950 p-4 text-[10px] leading-5 text-zinc-200">{JSON.stringify(apiResult, null, 2)}</pre>}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-5 min-w-0">
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>富媒体分片上传</CardTitle>
            <CardDescription>本地文件由服务端流式分片上传到 QQ，最大 200MB，不写入业务数据库。</CardDescription>
          </div>
          <Badge variant="outline">Upload API</Badge>
        </CardHeader>
        <CardContent>
          <form onSubmit={uploadMedia} className="grid gap-4 md:grid-cols-2">
            <label className="block"><span className="field-label">消息场景</span><Select value={mediaTargetType} onValueChange={(value) => setMediaTargetType(value as "c2c" | "group")} options={[{ value: "c2c", label: "单聊用户" }, { value: "group", label: "群聊" }]} ariaLabel="选择富媒体消息场景" /></label>
            <label className="block"><span className="field-label">媒体类型</span><Select value={mediaFileType} onValueChange={(value) => setMediaFileType(value as typeof mediaFileType)} options={[{ value: "1", label: "图片 PNG/JPG" }, { value: "2", label: "视频 MP4" }, { value: "3", label: "语音 SILK" }, { value: "4", label: "普通文件" }]} ariaLabel="选择媒体类型" /></label>
            <label className="block md:col-span-2"><span className="field-label">目标 OpenID</span><Input value={mediaTargetOpenid} onChange={(event) => setMediaTargetOpenid(event.target.value)} className="mono-data text-xs" required /></label>
            <div className="md:col-span-2"><span className="field-label">本地文件</span><FilePicker file={mediaFile} onFileChange={setMediaFile} browseLabel="选择媒体" emptyLabel="尚未选择媒体文件" helperText="支持图片、视频、语音与普通文件，最大 200MB" disabled={mediaSending} /></div>
            <div className="flex items-center gap-2 text-xs md:col-span-2"><Switch checked={mediaSendDirectly} onCheckedChange={setMediaSendDirectly} aria-label="上传完成后直接发送消息" /><span>上传完成后直接发送消息</span></div>
            {mediaError && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 md:col-span-2">{mediaError}</div>}
            <div className="md:col-span-2"><Button type="submit" disabled={mediaSending || !bots.length || !mediaFile}><FileUp size={14} />{mediaSending ? "正在分片上传..." : "上传到 QQ"}</Button></div>
          </form>
          {mediaResult !== null && <pre className="mono-data mt-5 max-h-80 max-w-full overflow-auto rounded-md bg-zinc-950 p-4 text-[10px] leading-5 text-zinc-200">{JSON.stringify(mediaResult, null, 2)}</pre>}
        </CardContent>
      </Card>
    </div>
  );
}
