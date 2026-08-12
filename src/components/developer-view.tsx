"use client";

import { useState } from "react";
import { BookOpen, Check, Copy, FileUp, Play, TerminalSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { Bot } from "@/types/platform";

export function DeveloperView({ bots }: { bots: Bot[] }) {
  const [copied, setCopied] = useState(false);
  const [botId, setBotId] = useState(bots[0]?.id || "");
  const [targetType, setTargetType] = useState<"c2c" | "group">("c2c");
  const [targetOpenid, setTargetOpenid] = useState("");
  const [content, setContent] = useState("你好，这是一条来自 StarBot 调试台的消息。");
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [apiMethod, setApiMethod] = useState<"GET" | "POST" | "PUT" | "PATCH" | "DELETE">("GET");
  const [apiPath, setApiPath] = useState("/gateway/bot");
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
  const manifest = [
    "import { StarBotClient } from '@starbot/node-sdk';",
    "",
    "const client = new StarBotClient({",
    "  platformUrl: process.env.STARBOT_PLATFORM_URL,",
    "  pluginId: process.env.STARBOT_PLUGIN_ID,",
    "  secret: process.env.STARBOT_PLUGIN_SECRET,",
    "});",
    "",
    "client.on('C2C_MESSAGE_CREATE', async (event, sdk) => {",
    "  await sdk.sendC2C(event.data.author.user_openid, {",
    "    content: '已收到', msg_type: 0, msg_id: event.data.id,",
    "  });",
    "});",
    "",
    "await client.start();",
  ].join("\n");

  async function copyManifest() {
    await navigator.clipboard.writeText(manifest);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
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
        body: JSON.stringify({ targetType, targetOpenid, content }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const failure = body as { message?: string; traceId?: string };
        throw new Error((failure.message || "发送失败") + (failure.traceId ? " · Trace " + failure.traceId : ""));
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
      const body = apiMethod === "GET" || apiMethod === "DELETE" ? undefined : JSON.parse(apiBody);
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
        const failure = body as { message?: string; traceId?: string; detail?: string };
        throw new Error([failure.message, failure.detail, failure.traceId ? "Trace " + failure.traceId : ""].filter(Boolean).join(" · ") || "富媒体上传失败");
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
        description="使用已添加的机器人凭据调用 QQ Bot API v2。"
        action={(
          <a href="https://bot.q.qq.com/wiki/develop/api-v2/" target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline" }))}>
            <BookOpen size={15} />QQ 官方文档
          </a>
        )}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="flex-row items-center justify-between border-b">
            <div>
              <CardTitle>Node.js SDK</CardTitle>
              <CardDescription>拉取事件、自动 ACK 与 OpenAPI 调用</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => void copyManifest()}>
              {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "已复制" : "复制"}
            </Button>
          </CardHeader>
          <pre className="mono-data max-w-full overflow-x-auto bg-zinc-950 p-5 text-[11px] leading-6 text-zinc-200">{manifest}</pre>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle>消息调试</CardTitle>
              <CardDescription>请求由服务端转发并写入事件日志</CardDescription>
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
                <span className="field-label">消息场景</span>
                <Select value={targetType} onValueChange={(value) => setTargetType(value as "c2c" | "group")} options={[{ value: "c2c", label: "单聊用户" }, { value: "group", label: "群聊" }]} ariaLabel="选择消息场景" />
              </label>
              <label className="block"><span className="field-label">目标 OpenID</span><Input value={targetOpenid} onChange={(event) => setTargetOpenid(event.target.value)} className="mono-data text-xs" required /></label>
              <label className="block"><span className="field-label">消息内容</span><Textarea value={content} onChange={(event) => setContent(event.target.value)} className="resize-none text-xs" required /></label>
              {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
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
      </div>

      <Card className="mt-5 min-w-0">
        <CardHeader>
          <CardTitle>OpenAPI 请求台</CardTitle>
          <CardDescription>按 QQ 官方文档填写相对路径，可调用机器人有权限访问的 REST API。</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={callOpenApi} className="grid gap-4 lg:grid-cols-[130px_minmax(0,1fr)]">
            <label className="block"><span className="field-label">HTTP 方法</span><Select value={apiMethod} onValueChange={(value) => setApiMethod(value as typeof apiMethod)} options={["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => ({ value: method, label: method }))} ariaLabel="选择 HTTP 方法" className="mono-data" /></label>
            <label className="block"><span className="field-label">官方 API 相对路径</span><Input value={apiPath} onChange={(event) => setApiPath(event.target.value)} className="mono-data text-xs" placeholder="/v2/users/{openid}/messages" required /></label>
            <label className="block lg:col-span-2"><span className="field-label">JSON 请求体</span><Textarea value={apiBody} onChange={(event) => setApiBody(event.target.value)} disabled={apiMethod === "GET" || apiMethod === "DELETE"} className="mono-data min-h-36 resize-y text-xs" /></label>
            {apiError && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 lg:col-span-2">{apiError}</div>}
            <div className="lg:col-span-2"><Button type="submit" disabled={apiSending || !bots.length}><Play size={14} />{apiSending ? "正在请求..." : "发送 OpenAPI 请求"}</Button></div>
          </form>
          {apiResult !== null && <pre className="mono-data mt-5 max-h-80 max-w-full overflow-auto rounded-md bg-zinc-950 p-4 text-[10px] leading-5 text-zinc-200">{JSON.stringify(apiResult, null, 2)}</pre>}
        </CardContent>
      </Card>

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
            <label className="block md:col-span-2"><span className="field-label">本地文件</span><Input type="file" onChange={(event) => setMediaFile(event.target.files?.[0] || null)} required /></label>
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
