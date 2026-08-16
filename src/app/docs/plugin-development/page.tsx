import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  Box,
  CheckCircle2,
  Download,
  ExternalLink,
  FileJson2,
  Globe2,
  KeyRound,
  PackageCheck,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { SiteFooter } from "@/components/site-footer";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getPublicSiteSettings } from "@/lib/system-settings-service";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "插件开发文档",
  description: "StarBot 托管插件的清单、事件、SDK、权限、构建与发布指南。",
};

const sections = [
  ["overview", "开发模型"],
  ["quickstart", "快速开始"],
  ["manifest", "插件清单"],
  ["events", "事件处理"],
  ["sdk", "SDK 能力"],
  ["permissions", "权限声明"],
  ["limits", "运行限制"],
  ["release", "发布流程"],
  ["troubleshooting", "错误排查"],
] as const;

const manifestFields = [
  ["schemaVersion", "固定为 1"],
  ["id", "3-64 位小写字母、数字与连字符；发布后保持稳定"],
  ["version", "语义化版本，例如 1.2.0"],
  ["entry", "插件包内安全的 .js 相对路径"],
  ["events", "订阅的 QQ 事件名；使用 * 接收平台已收到的全部事件"],
  ["permissions", "按最小权限原则声明 SDK 能力"],
  ["configSchema", "安装实例的可配置字段，最多 40 项"],
] as const;

const permissions = [
  ["reply:text", "回复文本消息"],
  ["reply:markdown", "回复 Markdown 消息"],
  ["reply:ark", "回复 Ark 消息"],
  ["reply:keyboard", "回复键盘消息"],
  ["qq:api", "调用受控 QQ OpenAPI"],
  ["http:request", "访问经过 SSRF 防护的公开 HTTP 服务"],
  ["storage:kv", "读写安装实例隔离的 KV"],
  ["log:write", "写入插件运行日志"],
] as const;

const runtimeLimits = [
  ["150ms", "单段 JavaScript CPU 截止时间"],
  ["30s", "包含网络等待的单次墙钟时间"],
  ["16MB", "QuickJS 内存上限"],
  ["12", "单次回复、KV 动作或网络请求上限"],
  ["64KB", "输入、输出及单个网络响应 JSON 上限"],
  ["2MB", "可导入 ZIP 包上限"],
] as const;

const installSnippet = [
  "npm install ./sdk/plugin",
  "npx starbot-plugin ./my-plugin ./dist/my-plugin.zip",
].join("\n");

const manifestSnippet = `{
  "schemaVersion": 1,
  "id": "keyword-reply",
  "name": "关键词回复",
  "version": "1.0.0",
  "description": "收到指定关键词时自动回复。",
  "author": "Your Name",
  "category": "消息互动",
  "tags": ["自动回复"],
  "entry": "index.js",
  "events": ["C2C_MESSAGE_CREATE", "GROUP_AT_MESSAGE_CREATE"],
  "permissions": ["reply:text", "storage:kv", "log:write"],
  "configSchema": [
    { "key": "keyword", "label": "关键词", "type": "text", "required": true, "default": "你好" }
  ]
}`;

const pluginSnippet = [
  "StarBot.definePlugin({",
  "  onEvent(event, sdk) {",
  "    const content = String(event.data && event.data.content || \"\");",
  "    if (!content.includes(String(sdk.config.keyword))) return;",
  "",
  "    const count = sdk.kv.get(\"count\", 0) + 1;",
  "    sdk.kv.set(\"count\", count);",
  "    sdk.reply.text(\"消息已收到，第 \" + count + \" 次触发。\");",
  "    sdk.log.info(\"keyword matched\", { count });",
  "  },",
  "});",
].join("\n");

const qqSnippet = `const result = await sdk.qq.callEndpoint(
  "sendGroupMessage",
  { group_openid: event.data.group_openid },
  { content: "处理完成", msg_type: 0 }
);

sdk.log.info("qq trace", result.traceId);`;

const httpSnippet = `const response = await sdk.http.request(
  "https://example.com/api/status",
  {
    method: "POST",
    headers: { "x-client": "starbot-plugin" },
    body: { eventType: event.type }
  }
);

if (!response.ok) sdk.log.warn("external api failed", response.status);`;

function InlineCode({ children }: { children: React.ReactNode }) {
  return <code className="mono-data rounded bg-muted px-1.5 py-0.5 text-[0.9em] text-foreground">{children}</code>;
}

function CodeBlock({ label, children }: { label: string; children: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 text-zinc-100">
      <div className="flex h-10 items-center justify-between border-b border-zinc-800 px-4 text-[10px] text-zinc-400">
        <span className="mono-data">{label}</span>
        <span>UTF-8</span>
      </div>
      <pre className="mono-data max-w-full overflow-x-auto p-4 text-[11px] leading-6 text-zinc-200"><code>{children}</code></pre>
    </div>
  );
}

function DocSection({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t pt-10 first:border-t-0 first:pt-0">
      <div className="mono-data text-[10px] font-semibold text-muted-foreground">{eyebrow}</div>
      <h2 className="mt-2 text-xl font-semibold tracking-normal sm:text-2xl">{title}</h2>
      <div className="mt-5 space-y-5 text-sm leading-7 text-muted-foreground">{children}</div>
    </section>
  );
}

export default function PluginDevelopmentPage() {
  const site = getPublicSiteSettings();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link href="/console" aria-label="返回控制台" className="focus-ring rounded-md">
            <BrandMark site={site} />
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/console" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
              <ArrowLeft size={14} /><span className="hidden sm:inline">返回控制台</span>
            </Link>
            <a href="/docs/plugin-development/download" download className={cn(buttonVariants({ variant: "default", size: "sm" }))}>
              <Download size={14} />下载 Markdown
            </a>
          </div>
        </div>
      </header>

      <div className="border-b bg-card">
        <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <BookOpen size={14} />开发者文档 <span aria-hidden="true">/</span> 托管插件
          </div>
          <div className="mt-6 grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="max-w-3xl">
              <div className="flex flex-wrap gap-2">
                <Badge variant="success">SDK 1.0</Badge>
                <Badge variant="outline">Manifest v1</Badge>
                <Badge variant="outline">Node.js 20+</Badge>
              </div>
              <h1 className="mt-5 text-3xl font-semibold tracking-normal sm:text-4xl">StarBot 插件开发文档</h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
                从本地目录到可安装 ZIP：定义事件、申请最小权限，在隔离运行时内回复消息、调用 QQ OpenAPI、保存状态或访问公开服务。
              </p>
            </div>
            <div className="grid grid-cols-3 divide-x rounded-md border bg-background">
              {[["3 步", "构建流程"], ["8 项", "可选权限"], ["2MB", "包体上限"]].map(([value, label]) => (
                <div key={label} className="px-3 py-4 text-center">
                  <div className="mono-data text-sm font-semibold">{value}</div>
                  <div className="mt-1 text-[10px] text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-7 flex flex-wrap gap-2">
            <a href="/docs/plugin-development/download" download className={cn(buttonVariants({ variant: "default" }))}>
              <Download size={15} />下载完整文档
            </a>
            <a href="https://bot.q.qq.com/wiki/develop/api-v2/" target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline" }))}>
              <ExternalLink size={15} />QQ API v2 官方文档
            </a>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1440px] gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[220px_minmax(0,820px)_minmax(220px,1fr)] lg:px-8 lg:py-14">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="mb-3 text-[11px] font-semibold text-foreground">本页目录</div>
          <nav aria-label="插件开发文档目录" className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-1">
            {sections.map(([id, label], index) => (
              <a key={id} href={`#${id}`} className="focus-ring flex min-h-9 items-center gap-2 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
                <span className="mono-data text-[9px] text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>{label}
              </a>
            ))}
          </nav>
        </aside>

        <main className="min-w-0">
          <article className="space-y-12">
            <DocSection id="overview" eyebrow="01 / MODEL" title="平台托管，而不是自建回调服务">
              <p>插件只包含清单、入口脚本和可选 README。QQ 事件、机器人凭据、Access Token 刷新、安装配置与版本审核由平台负责，插件不会拿到 Client Secret。</p>
              <div className="grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
                {[
                  <div key="qq" className="bg-card p-4"><div className="flex items-center gap-2 font-medium text-foreground"><Globe2 size={15} />QQ 平台</div><p className="mt-1 text-xs leading-5">推送事件并提供 OpenAPI</p></div>,
                  <div key="arrow-1" className="hidden place-items-center bg-muted px-3 text-muted-foreground sm:grid">→</div>,
                  <div key="starbot" className="bg-card p-4"><div className="flex items-center gap-2 font-medium text-foreground"><ShieldCheck size={15} />StarBot</div><p className="mt-1 text-xs leading-5">鉴权、过滤、隔离与限额</p></div>,
                  <div key="arrow-2" className="hidden place-items-center bg-muted px-3 text-muted-foreground sm:grid">→</div>,
                  <div key="plugin" className="bg-card p-4"><div className="flex items-center gap-2 font-medium text-foreground"><Box size={15} />插件</div><p className="mt-1 text-xs leading-5">处理事件并调用受控 SDK</p></div>,
                ]}
              </div>
              <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-900">
                <strong>凭据边界：</strong>QQ 官方要求 Access Token 只在服务端使用。插件调用 <InlineCode>sdk.qq</InlineCode> 时只提交相对路径，禁止写入 AppID、Client Secret 或 Access Token。
              </div>
            </DocSection>

            <DocSection id="quickstart" eyebrow="02 / START" title="三步生成可导入插件包">
              <p>准备 Node.js 20 或更高版本。在仓库根目录安装本地 SDK，然后把插件目录构建为 ZIP。</p>
              <CodeBlock label="PowerShell / Bash">{installSnippet}</CodeBlock>
              <div className="grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-3">
                {[["01", "编写", "创建清单与 index.js"], ["02", "构建", "运行 starbot-plugin"], ["03", "导入", "在插件中心绑定机器人"]].map(([step, title, detail]) => (
                  <div key={step} className="bg-card p-4">
                    <div className="mono-data text-[10px]">STEP {step}</div>
                    <div className="mt-2 text-sm font-semibold text-foreground">{title}</div>
                    <div className="mt-1 text-xs leading-5">{detail}</div>
                  </div>
                ))}
              </div>
              <p>最小目录包含 <InlineCode>starbot.plugin.json</InlineCode>、入口脚本和可选的 <InlineCode>README.md</InlineCode>。也可以直接构建仓库中的 <InlineCode>examples/hosted-plugin</InlineCode> 示例。</p>
            </DocSection>

            <DocSection id="manifest" eyebrow="03 / MANIFEST" title="用清单声明能力边界">
              <CodeBlock label="starbot.plugin.json">{manifestSnippet}</CodeBlock>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead className="bg-muted/60 text-foreground"><tr><th className="px-4 py-3 font-semibold">字段</th><th className="px-4 py-3 font-semibold">规则</th></tr></thead>
                  <tbody className="divide-y">{manifestFields.map(([field, rule]) => <tr key={field}><td className="mono-data px-4 py-3 text-foreground">{field}</td><td className="px-4 py-3">{rule}</td></tr>)}</tbody>
                </table>
              </div>
              <p>配置字段支持 <InlineCode>text</InlineCode>、<InlineCode>textarea</InlineCode>、<InlineCode>number</InlineCode>、<InlineCode>boolean</InlineCode> 与 <InlineCode>select</InlineCode>。配置按安装实例保存，同一插件在不同机器人上可以使用不同值。</p>
            </DocSection>

            <DocSection id="events" eyebrow="04 / EVENTS" title="每个事件只进入一个受控处理器">
              <p>入口脚本必须且只能调用一次 <InlineCode>StarBot.definePlugin</InlineCode>。<InlineCode>event.data</InlineCode> 保留 QQ 官方事件载荷；事件字段应以 QQ API v2 对应事件文档为准。</p>
              <CodeBlock label="index.js">{pluginSnippet}</CodeBlock>
              <p><InlineCode>onEvent</InlineCode> 支持同步或异步函数。运行时不提供 Node.js 模块、文件系统、环境变量、定时器、原生 fetch 或套接字；网络访问必须通过受控 SDK。</p>
            </DocSection>

            <DocSection id="sdk" eyebrow="05 / SDK" title="回复、QQ API、外部 HTTP 与状态">
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  [TerminalSquare, "sdk.reply", "按事件场景回复文本、Markdown、Ark 或键盘。"],
                  [BookOpen, "sdk.qq", "调用内置端点目录或安全的 QQ 相对路径。"],
                  [Globe2, "sdk.http", "访问公开 HTTP/HTTPS 服务，自动阻断内网地址。"],
                  [KeyRound, "sdk.kv / sdk.log", "保存安装级状态并写入受控运行日志。"],
                ].map(([Icon, title, detail]) => (
                  <div key={String(title)} className="rounded-md border bg-card p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><Icon size={15} />{String(title)}</div>
                    <p className="mt-2 text-xs leading-5">{String(detail)}</p>
                  </div>
                ))}
              </div>
              <h3 className="pt-2 text-sm font-semibold text-foreground">QQ OpenAPI</h3>
              <CodeBlock label="QQ API request">{qqSnippet}</CodeBlock>
              <p>平台统一请求 <InlineCode>https://api.bot.qq.com</InlineCode> 并补充鉴权头。返回值包含 <InlineCode>body</InlineCode> 与 <InlineCode>traceId</InlineCode>；Trace ID 来自 <InlineCode>X-Tps-trace-ID</InlineCode> 或响应体 <InlineCode>trace_id</InlineCode>，应随错误日志保留。</p>
              <h3 className="pt-2 text-sm font-semibold text-foreground">外部 HTTP</h3>
              <CodeBlock label="External HTTP request">{httpSnippet}</CodeBlock>
              <p>外部请求最多跟随 3 次重定向，请求体最大 32KB、响应体最大 64KB。URL 内嵌凭据、localhost、内网/保留地址及危险请求头会被拒绝；跨域重定向会移除 authorization 与 cookie。</p>
            </DocSection>

            <DocSection id="permissions" eyebrow="06 / SECURITY" title="只申请代码实际使用的权限">
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead className="bg-muted/60 text-foreground"><tr><th className="px-4 py-3 font-semibold">权限</th><th className="px-4 py-3 font-semibold">允许的能力</th></tr></thead>
                  <tbody className="divide-y">{permissions.map(([permission, ability]) => <tr key={permission}><td className="mono-data px-4 py-3 text-foreground">{permission}</td><td className="px-4 py-3">{ability}</td></tr>)}</tbody>
                </table>
              </div>
              <p>权限在副作用发生前验证。插件不能读取机器人密钥、平台数据库、宿主文件或环境变量。<InlineCode>qq:api</InlineCode> 与 <InlineCode>http:request</InlineCode> 相互独立，不能用外部 HTTP 绕过 QQ 请求校验。</p>
            </DocSection>

            <DocSection id="limits" eyebrow="07 / LIMITS" title="为共享运行时控制资源消耗">
              <div className="grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2 lg:grid-cols-3">
                {runtimeLimits.map(([value, label]) => (
                  <div key={label} className="bg-card p-4"><div className="mono-data text-base font-semibold text-foreground">{value}</div><div className="mt-1 text-xs leading-5">{label}</div></div>
                ))}
              </div>
              <p>ZIP 最多 40 个文件，单文件最大 1MB，总解压大小最大 4MB；插件连续 5 次失败后，安装实例会自动停用。不要在单次事件处理中循环重试 QQ 429 或外部 5xx。</p>
            </DocSection>

            <DocSection id="release" eyebrow="08 / RELEASE" title="私有验证通过后再申请上架">
              <ol className="space-y-3">
                {[
                  "首次导入创建私有项目与版本，可安装到自己的机器人。",
                  "相同 id、不同 version 会进入同一项目的版本列表。",
                  "完成配置、事件与权限验证后，选择版本申请市场审核。",
                  "管理员审核通过后，该版本成为插件市场当前版本。",
                  "市场安装默认停用，用户完成配置后再手动启用。",
                ].map((item, index) => <li key={item} className="flex gap-3"><span className="mono-data grid h-6 w-6 shrink-0 place-items-center rounded-md bg-muted text-[10px] text-foreground">{index + 1}</span><span>{item}</span></li>)}
              </ol>
              <div className="flex items-start gap-3 rounded-md border bg-card p-4 text-xs leading-6"><PackageCheck size={17} className="mt-0.5 shrink-0 text-emerald-600" /><p>仓库中的测试插件可在开发者中心直接下载，用于先验证导入、配置、事件与日志链路。</p></div>
            </DocSection>

            <DocSection id="troubleshooting" eyebrow="09 / DEBUG" title="从安装状态、权限和 Trace ID 开始排查">
              <div className="space-y-2">
                {[
                  "确认安装实例已启用、机器人在线，事件类型包含在清单 events 中。",
                  "PLUGIN_PERMISSION_DENIED:* 表示清单缺少实际调用所需权限。",
                  "QQ 请求失败时记录 HTTP 状态和 Trace ID，再对照官方错误码；不要依赖 message 文案判断。",
                  "HTTP 429 表示触发限频，应降低调用频率；不要在一次处理器内无界重试。",
                  "实例自动停用后，先修复代码或配置、发布新版本，再手动启用。",
                ].map((item) => <div key={item} className="flex gap-3 rounded-md border bg-card px-4 py-3 text-xs leading-6"><CheckCircle2 size={15} className="mt-1 shrink-0 text-emerald-600" /><span>{item}</span></div>)}
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <a href="https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/access-token.html" target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}><ExternalLink size={14} />访问凭证</a>
                <a href="https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/api-call-guide.html" target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}><ExternalLink size={14} />API 调用指南</a>
                <a href="/docs/plugin-development/download" download className={cn(buttonVariants({ variant: "default", size: "sm" }))}><Download size={14} />下载完整 Markdown</a>
              </div>
            </DocSection>
          </article>
        </main>

        <aside className="hidden self-start xl:block xl:sticky xl:top-24">
          <div className="rounded-md border bg-card p-4">
            <div className="flex items-center gap-2 text-xs font-semibold"><FileJson2 size={14} />开发检查</div>
            <div className="mt-3 space-y-3 text-[11px] leading-5 text-muted-foreground">
              <p>清单使用 schemaVersion 1</p>
              <p>事件名来自 QQ 官方事件</p>
              <p>权限与代码调用一致</p>
              <p>包内不包含任何密钥</p>
              <p>先私有安装，再申请审核</p>
            </div>
          </div>
        </aside>
      </div>

      <SiteFooter site={site} />
    </div>
  );
}
