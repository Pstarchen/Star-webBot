import Link from "next/link";
import { ArrowRight, Blocks, Bot, Braces, Check, Code2, Database, ExternalLink, FileCode2, Gauge, Globe2, LayoutDashboard, PlugZap, RadioTower, ShieldCheck, Webhook } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { OfficialHomeMotion } from "@/components/official-home-motion";
import { SiteFooter } from "@/components/site-footer";
import type { SitePublicSettings } from "@/types/platform";

type Feature = {
  icon: typeof Bot;
  title: string;
  detail: string;
  note: string;
  tone: string;
};

const features: Feature[] = [
  { icon: Bot, title: "多 QQ 机器人", detail: "统一管理应用凭据、配额、成员和运行状态。", note: "账号与权限", tone: "bg-amber-100 text-amber-900" },
  { icon: RadioTower, title: "双接入模式", detail: "WebSocket 托管连接与官方 Webhook 事件推送按机器人独立选择。", note: "事件链路", tone: "bg-sky-100 text-sky-900" },
  { icon: Blocks, title: "插件运行平台", detail: "导入 ZIP、配置权限、按实例启停，并在隔离运行时中保留执行记录。", note: "SDK + 托管运行", tone: "bg-emerald-100 text-emerald-900" },
  { icon: ShieldCheck, title: "运营与治理", detail: "成员角色、机器人额度、会员方案、支付回调与审计记录均在服务端生效。", note: "可控发布", tone: "bg-rose-100 text-rose-900" },
];

function ProductScene() {
  return (
    <div aria-hidden="true" className="motion-hero motion-hero-delay-5 pointer-events-none relative mx-auto mt-10 hidden h-[480px] max-w-7xl overflow-hidden border-x border-t bg-background lg:block">
      <div className="absolute inset-x-0 top-0 flex h-12 items-center justify-between border-b bg-card px-5 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-3"><span className="grid h-6 w-6 place-items-center rounded border bg-muted text-foreground"><Bot size={13} /></span><span className="font-semibold text-foreground">运行控制台</span><span>机器人 / 事件 / 插件</span></div>
        <div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /><span>服务正常</span></div>
      </div>
      <div className="grid h-full grid-cols-[176px_minmax(0,1fr)_230px] pt-12">
        <div className="border-r bg-muted/30 p-4">
          {[["总览", true], ["机器人", false], ["事件中心", false], ["插件中心", false], ["开发者", false]].map(([label, active]) => <div key={String(label)} className={`mb-1 flex h-8 items-center rounded px-3 text-[10px] ${active ? "bg-foreground text-background" : "text-muted-foreground"}`}>{String(label)}</div>)}
        </div>
        <div className="p-6">
          <div className="flex items-end justify-between border-b pb-5"><div><div className="text-lg font-semibold text-foreground">机器人运行概览</div><div className="mt-1 text-[10px] text-muted-foreground">事件链路与插件实例实时汇总</div></div><div className="rounded border bg-card px-3 py-2 text-[10px] text-foreground">添加机器人</div></div>
          <div className="mt-5 grid grid-cols-3 gap-3">
            {[["在线机器人", "04", "bg-emerald-500"], ["24h 事件", "2,481", "bg-sky-500"], ["插件实例", "12", "bg-amber-500"]].map(([label, value, tone]) => <div key={label} className="border bg-card p-4"><div className="text-[10px] text-muted-foreground">{label}</div><div className="mt-3 flex items-end justify-between"><span className="text-2xl font-semibold text-foreground">{value}</span><span className={`mb-1 h-1.5 w-7 rounded-full ${tone}`} /></div></div>)}
          </div>
          <div className="mt-5 border bg-card"><div className="flex h-11 items-center justify-between border-b px-4 text-[10px] text-muted-foreground"><span className="font-semibold text-foreground">最近事件</span><span>全部事件</span></div>{["GROUP_AT_MESSAGE_CREATE", "C2C_MESSAGE_CREATE", "WEBHOOK_DELIVERED"].map((event, index) => <div key={event} className="grid h-12 grid-cols-[1fr_90px_54px] items-center border-b px-4 text-[10px] last:border-b-0"><span className="font-medium text-foreground">{event}</span><span className="text-muted-foreground">机器人 #{index + 1}</span><span className="text-emerald-700">成功</span></div>)}</div>
        </div>
        <div className="border-l bg-muted/20 p-5"><div className="text-[10px] font-semibold text-foreground">运行状态</div><div className="mt-4 space-y-3">{[["Gateway", "已连接", "text-emerald-700"], ["Webhook", "校验正常", "text-emerald-700"], ["插件队列", "12 等待", "text-amber-700"]].map(([label, value, tone]) => <div key={label} className="border bg-card p-3"><div className="text-[10px] text-muted-foreground">{label}</div><div className={`mt-2 text-xs font-semibold ${tone}`}>{value}</div></div>)}</div><div className="mt-6 border-t pt-5 text-[10px] leading-5 text-muted-foreground">所有机器人凭据只在服务端加密保存，插件按权限访问 QQ OpenAPI。</div></div>
      </div>
    </div>
  );
}

export function OfficialHome({ site, signedIn }: { site: SitePublicSettings; signedIn: boolean }) {
  const workspaceHref = signedIn ? "/console" : "/login";
  const workspaceLabel = signedIn ? "进入控制台" : "登录控制台";
  return (
    <main className="min-h-[100dvh] bg-background text-foreground">
      <OfficialHomeMotion />
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-5 px-4 sm:px-6">
          <Link href="/" aria-label={`${site.siteName} 首页`}><BrandMark site={site} /></Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="官网导航">
            <a href="#capabilities" className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">平台能力</a>
            <a href="#workflow" className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">接入方式</a>
            <a href="#develop" className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">插件开发</a>
          </nav>
          <div className="flex items-center gap-2"><a href="https://github.com/Pstarchen/Star-webBot#readme" target="_blank" rel="noreferrer" className="hidden h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground sm:inline-flex"><Code2 size={15} />文档</a><Link href={workspaceHref} className="inline-flex h-9 items-center gap-2 rounded-md bg-foreground px-3.5 text-xs font-semibold text-background shadow-sm transition-colors hover:bg-foreground/90"><LayoutDashboard size={15} />{workspaceLabel}</Link></div>
        </div>
      </header>

      <section className="motion-hero overflow-hidden border-b">
        <div className="mx-auto flex max-w-5xl flex-col items-center px-4 pb-12 pt-16 text-center sm:px-6 sm:pb-14 sm:pt-20 lg:pb-8 lg:pt-20">
          <div className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground"><span className="grid h-5 w-5 place-items-center rounded border bg-muted text-foreground"><Bot size={12} /></span>QQ 官方机器人管理与开发平台</div>
          <h1 className="mt-7 max-w-4xl text-3xl font-semibold leading-[1.2] sm:text-5xl lg:text-6xl">让每个 QQ 机器人<br className="hidden sm:block" />都在可控的运行系统中成长</h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">{site.siteDescription}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row"><Link href={workspaceHref} className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-foreground px-5 text-sm font-semibold text-background shadow-sm transition-colors hover:bg-foreground/90">{signedIn ? "返回运行控制台" : "开始管理机器人"}<ArrowRight size={16} /></Link><a href="#capabilities" className="inline-flex h-11 items-center justify-center gap-2 rounded-md border bg-card px-5 text-sm font-semibold text-foreground transition-colors hover:bg-muted">了解平台能力</a></div>
          <div className="mt-8 grid w-full max-w-sm grid-cols-2 gap-2 text-xs text-muted-foreground sm:flex sm:w-auto sm:max-w-none sm:flex-wrap sm:justify-center"><span className="min-w-0 rounded-md border bg-card px-2 py-1.5 text-center sm:px-3">多用户协作</span><span className="min-w-0 rounded-md border bg-card px-2 py-1.5 text-center sm:px-3">WebSocket / Webhook</span><span className="min-w-0 rounded-md border bg-card px-2 py-1.5 text-center sm:px-3">SDK 插件开发</span><span className="min-w-0 rounded-md border bg-card px-2 py-1.5 text-center sm:px-3">SQLite / MySQL</span></div>
        </div>
        <ProductScene />
      </section>

      <section id="capabilities" data-reveal className="border-b">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,0.74fr)_minmax(0,1.26fr)] lg:py-24">
          <div className="lg:pr-12"><div className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Gauge size={14} />平台能力</div><h2 className="mt-4 text-3xl font-semibold leading-tight sm:text-4xl">从连接到运营，<br />保持同一套控制面。</h2><p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground">不把 QQ 机器人拆成一堆孤立脚本。应用接入、事件追踪、插件运行、成员配额与账单都由可审计的服务端能力承载。</p><Link href="/login" className="mt-7 inline-flex items-center gap-2 text-sm font-semibold hover:text-muted-foreground">登录后开始配置 <ArrowRight size={15} /></Link></div>
          <div className="grid border-t sm:grid-cols-2 sm:border-l">{features.map((feature) => <article key={feature.title} className="border-b py-7 sm:border-r sm:px-7 lg:py-9"><div className={`grid h-9 w-9 place-items-center rounded-md ${feature.tone}`}><feature.icon size={17} /></div><div className="mt-5 text-[11px] font-semibold text-muted-foreground">{feature.note}</div><h3 className="mt-2 text-lg font-semibold">{feature.title}</h3><p className="mt-3 text-sm leading-7 text-muted-foreground">{feature.detail}</p></article>)}</div>
        </div>
      </section>

      <section id="workflow" data-reveal className="border-b bg-muted/35">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24"><div className="max-w-2xl"><div className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Globe2 size={14} />接入方式</div><h2 className="mt-4 text-3xl font-semibold leading-tight sm:text-4xl">按机器人选择合适的事件通道。</h2></div><div className="mt-10 grid border bg-card lg:grid-cols-2"><article className="p-6 lg:p-9"><div className="flex items-center justify-between"><div className="grid h-10 w-10 place-items-center rounded-md bg-foreground text-background"><RadioTower size={18} /></div><span className="text-xs font-semibold text-emerald-700">平台托管</span></div><h3 className="mt-7 text-xl font-semibold">WebSocket Gateway</h3><p className="mt-3 max-w-lg text-sm leading-7 text-muted-foreground">平台管理 Identify、分片、心跳、断线恢复与事件持久化。适合希望由平台持续托管连接的机器人。</p><div className="mt-7 flex items-center gap-2 text-xs text-muted-foreground"><Check size={14} className="text-emerald-600" />无需手填 Intents 位图</div></article><article className="border-t p-6 lg:border-l lg:border-t-0 lg:p-9"><div className="flex items-center justify-between"><div className="grid h-10 w-10 place-items-center rounded-md border bg-muted"><Webhook size={18} /></div><span className="text-xs font-semibold text-sky-700">官方推送</span></div><h3 className="mt-7 text-xl font-semibold">Webhook 事件接入</h3><p className="mt-3 max-w-lg text-sm leading-7 text-muted-foreground">为每个机器人生成独立的签名校验路径，完成 challenge、身份验证与事件去重。适合已有公网 HTTPS 运维体系的服务。</p><div className="mt-7 flex items-center gap-2 text-xs text-muted-foreground"><Check size={14} className="text-emerald-600" />事件订阅在 QQ 开放平台完成</div></article></div></div>
      </section>

      <section id="develop" data-reveal className="border-b">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:py-24"><div><div className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Braces size={14} />插件开发</div><h2 className="mt-4 max-w-xl text-3xl font-semibold leading-tight sm:text-4xl">把机器人能力写成可安装、可治理、可持续交付的插件。</h2><p className="mt-5 max-w-xl text-sm leading-7 text-muted-foreground">开发者通过 SDK 声明事件、权限和配置字段。平台负责包校验、实例隔离、运行记录、KV 存储与 QQ OpenAPI 受控访问。</p><div className="mt-8 flex flex-wrap gap-2">{[[FileCode2, "ZIP 导入与版本管理"], [PlugZap, "按机器人安装配置"], [ShieldCheck, "最小权限运行"], [Database, "安装级 KV 存储"]].map(([Icon, label]) => <span key={String(label)} className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs font-medium"><Icon size={14} />{String(label)}</span>)}</div></div><div className="border bg-zinc-950 p-5 text-zinc-100 shadow-sm sm:p-6"><div className="flex items-center justify-between border-b border-zinc-800 pb-4 text-[10px] text-zinc-400"><span className="mono-data">plugin/index.js</span><span className="text-emerald-400">运行正常</span></div><pre className="mono-data mt-5 overflow-x-auto text-[11px] leading-6 text-zinc-300">{`StarBot.definePlugin({\n  onEvent(event, sdk) {\n    if (event.type === "GROUP_AT_MESSAGE_CREATE") {\n      sdk.reply.text("已收到群消息");\n      sdk.log.info("event handled");\n    }\n  }\n});`}</pre><div className="mt-5 border-t border-zinc-800 pt-4 text-[10px] leading-5 text-zinc-400">声明式事件处理、受控回复 API 与运行日志都绑定到插件实例。</div></div></div>
      </section>

      <section className="bg-foreground text-background"><div className="mx-auto flex max-w-7xl flex-col gap-7 px-4 py-16 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:py-20"><div><div className="text-xs font-semibold text-background/60">StarBot Platform</div><h2 className="mt-4 max-w-2xl text-3xl font-semibold leading-tight sm:text-4xl">把第一台机器人接入平台，<br />再把能力交给团队和插件。</h2></div><div className="flex flex-col gap-3 sm:flex-row"><Link href={workspaceHref} className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-background px-5 text-sm font-semibold text-foreground transition-colors hover:bg-background/90">{workspaceLabel}<ArrowRight size={16} /></Link><a href="https://github.com/Pstarchen/Star-webBot#readme" target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-background/25 px-5 text-sm font-semibold text-background transition-colors hover:bg-background/10">阅读部署文档<ExternalLink size={15} /></a></div></div></section>

      <div className="border-t"><div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-7 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6"><BrandMark site={site} compact /><div className="flex items-center gap-4"><a href="#capabilities" className="hover:text-foreground">平台能力</a><a href="https://github.com/Pstarchen/Star-webBot#readme" target="_blank" rel="noreferrer" className="hover:text-foreground">文档</a><Link href={workspaceHref} className="hover:text-foreground">控制台</Link></div></div><SiteFooter site={site} /></div>
    </main>
  );
}
