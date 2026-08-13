"use client";

import { useEffect, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Check, Copy, CreditCard, FileImage, Globe2, KeyRound, LoaderCircle, Mail, MessageCircle, ReceiptText, Save, Settings2, ShieldCheck, UploadCloud } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FilePicker } from "@/components/ui/file-picker";
import { Input, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { AdminSystemSettings, MembershipOrder, MembershipPlan, PaymentProvider, SitePublicSettings } from "@/types/platform";

const cycleLabels = { monthly: "月付", quarterly: "季付", yearly: "年付" } as const;

async function requestJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) throw new Error(body.message || "请求失败");
  return body;
}

function cents(value: string) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function yuan(value: number) {
  return (value / 100).toFixed(value % 100 ? 2 : 0);
}

export function SystemSettingsView({ onSiteChange }: { onSiteChange: (site: SitePublicSettings) => void }) {
  const [settings, setSettings] = useState<AdminSystemSettings | null>(null);
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [orders, setOrders] = useState<MembershipOrder[]>([]);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [secret, setSecret] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [epayKey, setEpayKey] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    const [settingsBody, plansBody, ordersBody] = await Promise.all([
      requestJson<{ settings: AdminSystemSettings }>("/api/system-settings", { cache: "no-store" }),
      requestJson<{ plans: MembershipPlan[] }>("/api/membership-plans", { cache: "no-store" }),
      requestJson<{ orders: MembershipOrder[] }>("/api/membership/orders", { cache: "no-store" }),
    ]);
    setSettings(settingsBody.settings);
    setPlans(plansBody.plans);
    setOrders(ordersBody.orders);
  }

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      requestJson<{ settings: AdminSystemSettings }>("/api/system-settings", { cache: "no-store", signal: controller.signal }),
      requestJson<{ plans: MembershipPlan[] }>("/api/membership-plans", { cache: "no-store", signal: controller.signal }),
      requestJson<{ orders: MembershipOrder[] }>("/api/membership/orders", { cache: "no-store", signal: controller.signal }),
    ])
      .then(([settingsBody, plansBody, ordersBody]) => {
        setSettings(settingsBody.settings);
        setPlans(plansBody.plans);
        setOrders(ordersBody.orders);
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "系统设置加载失败");
      });
    return () => controller.abort();
  }, []);

  async function run(key: string, action: () => Promise<void>, message: string) {
    setBusy(key); setError(""); setSuccess("");
    try { await action(); setSuccess(message); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "操作失败"); }
    finally { setBusy(""); }
  }

  if (!settings) return error
    ? <div className="grid min-h-80 place-items-center"><div className="text-center"><div className="text-sm text-red-700">{error}</div><Button variant="outline" className="mt-4" onClick={() => { setError(""); void load().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "系统设置加载失败")); }}>重新加载</Button></div></div>
    : <div className="grid min-h-80 place-items-center text-sm text-muted-foreground"><LoaderCircle className="animate-spin" size={20} />正在加载系统设置</div>;

  async function saveSite() {
    const current = settings;
    if (!current) return;
    const body = await requestJson<{ settings: AdminSystemSettings }>("/api/system-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ section: "site", ...current.site, logoUrl: undefined, faviconUrl: undefined }) });
    setSettings(body.settings); onSiteChange(body.settings.site);
  }

  async function uploadAsset(kind: "logo" | "favicon", file: File | null) {
    const current = settings;
    if (!file || !current) return;
    const body = await requestJson<{ url: string }>(`/api/system-settings/assets/${kind}`, { method: "PUT", headers: { "Content-Type": file.type || "image/png" }, body: file });
    const nextSite = { ...current.site, [kind === "logo" ? "logoUrl" : "faviconUrl"]: body.url };
    setSettings({ ...current, site: nextSite }); onSiteChange(nextSite);
  }

  async function saveQQ() {
    const current = settings;
    if (!current) return;
    const body = await requestJson<{ settings: AdminSystemSettings }>("/api/system-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ section: "qq", ...current.qq, appSecret: secret || undefined }) });
    setSettings(body.settings); setSecret("");
  }

  async function saveEmail() {
    const current = settings;
    if (!current) return;
    const body = await requestJson<{ settings: AdminSystemSettings }>("/api/system-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section: "email", ...current.email, smtpPass: smtpPass || undefined }),
    });
    setSettings(body.settings); setSmtpPass("");
  }

  async function copyQQCallback() {
    if (!settings?.qq.redirectUri) return;
    await navigator.clipboard.writeText(settings.qq.redirectUri);
    setSuccess("回调地址已复制");
  }

  async function savePayment() {
    const current = settings;
    if (!current) return;
    const body = await requestJson<{ settings: AdminSystemSettings }>("/api/system-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ section: "payment", ...current.payment, epayKey: epayKey || undefined }) });
    setSettings(body.settings); setEpayKey("");
  }

  async function savePlan(plan: MembershipPlan) {
    const body = await requestJson<{ plan: MembershipPlan }>("/api/membership-plans", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(plan) });
    setPlans((current) => current.map((item) => item.id === body.plan.id ? body.plan : item));
  }

  async function confirmOrder(order: MembershipOrder) {
    await requestJson(`/api/membership/orders/${order.id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerTradeNo: `manual-${order.orderNo}`, note: "管理员人工确认" }) });
    await load();
  }

  return (
    <div>
      <PageHeader title="系统设置" description="管理站点品牌、备案信息、QQ 登录、支付渠道、会员价格与订单审核。" />
      {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>}
      {success && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700"><Check size={14} className="mr-2 inline" />{success}</div>}

      <Tabs.Root defaultValue="site">
        <Tabs.List className="mb-5 flex gap-1 overflow-x-auto border-b" aria-label="系统设置分类">
          {[["site", Globe2, "站点"], ["qq", MessageCircle, "QQ 登录"], ["email", Mail, "邮箱"], ["payment", CreditCard, "支付"], ["plans", Settings2, "套餐"], ["orders", ReceiptText, "订单"]].map(([value, Icon, label]) => <Tabs.Trigger key={String(value)} value={String(value)} className="flex h-10 shrink-0 items-center gap-2 border-b-2 border-transparent px-3 text-xs font-medium text-muted-foreground outline-none data-[state=active]:border-foreground data-[state=active]:text-foreground"><Icon size={14} />{String(label)}</Tabs.Trigger>)}
        </Tabs.List>

        <Tabs.Content value="site" className="outline-none">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Card><CardHeader className="border-b"><CardTitle>站点信息</CardTitle><CardDescription>用于浏览器标题、登录页、侧栏和备案页脚。</CardDescription></CardHeader><CardContent className="grid gap-4 pt-5 md:grid-cols-2">
              <label><span className="field-label">网站名称</span><Input value={settings.site.siteName} onChange={(event) => setSettings({ ...settings, site: { ...settings.site, siteName: event.target.value } })} /></label>
              <label><span className="field-label">短标语</span><Input value={settings.site.siteTagline} onChange={(event) => setSettings({ ...settings, site: { ...settings.site, siteTagline: event.target.value } })} /></label>
              <label className="md:col-span-2"><span className="field-label">网站介绍</span><Textarea value={settings.site.siteDescription} onChange={(event) => setSettings({ ...settings, site: { ...settings.site, siteDescription: event.target.value } })} className="min-h-24 resize-y" /></label>
              <label><span className="field-label">ICP备案号</span><Input value={settings.site.icpCode} onChange={(event) => setSettings({ ...settings, site: { ...settings.site, icpCode: event.target.value } })} placeholder="京ICP备xxxxxxxx号" /></label>
              <label><span className="field-label">ICP备案链接</span><Input value={settings.site.icpUrl} onChange={(event) => setSettings({ ...settings, site: { ...settings.site, icpUrl: event.target.value } })} /></label>
              <label><span className="field-label">网安备案号</span><Input value={settings.site.policeCode} onChange={(event) => setSettings({ ...settings, site: { ...settings.site, policeCode: event.target.value } })} placeholder="京公网安备 xxxxxxxxx号" /></label>
              <label><span className="field-label">网安备案链接</span><Input value={settings.site.policeUrl} onChange={(event) => setSettings({ ...settings, site: { ...settings.site, policeUrl: event.target.value } })} /></label>
              <label className="md:col-span-2"><span className="field-label">版权主体</span><Input value={settings.site.copyrightText} onChange={(event) => setSettings({ ...settings, site: { ...settings.site, copyrightText: event.target.value } })} /></label>
              <div className="md:col-span-2"><Button onClick={() => void run("site", saveSite, "站点信息已保存")} disabled={busy === "site"}><Save size={14} />保存站点信息</Button></div>
            </CardContent></Card>
            <div className="space-y-5"><Card><CardHeader><CardTitle className="flex items-center gap-2"><FileImage size={15} />网站 Logo</CardTitle></CardHeader><CardContent><FilePicker file={logoFile} onFileChange={setLogoFile} accept="image/png,image/jpeg,image/webp" helperText="建议正方形，最大 512KB" browseLabel="选择图片" /><Button className="mt-3 w-full" variant="outline" disabled={!logoFile || busy === "logo"} onClick={() => void run("logo", () => uploadAsset("logo", logoFile), "Logo 已更新")}><UploadCloud size={14} />上传 Logo</Button></CardContent></Card><Card><CardHeader><CardTitle className="flex items-center gap-2"><FileImage size={15} />浏览器图标</CardTitle></CardHeader><CardContent><FilePicker file={faviconFile} onFileChange={setFaviconFile} accept="image/png,image/jpeg,image/webp,image/x-icon" helperText="推荐 64×64 PNG 或 ICO，最大 512KB" browseLabel="选择图标" /><Button className="mt-3 w-full" variant="outline" disabled={!faviconFile || busy === "favicon"} onClick={() => void run("favicon", () => uploadAsset("favicon", faviconFile), "网站图标已更新")}><UploadCloud size={14} />上传图标</Button></CardContent></Card></div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="qq" className="outline-none">
          <Card className="max-w-4xl overflow-hidden">
            <CardHeader className="border-b px-5 py-5 sm:px-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="flex items-center gap-2"><MessageCircle size={15} />QQ 互联登录</CardTitle>
                    <Badge variant={settings.qq.enabled ? "success" : "secondary"}>{settings.qq.enabled ? "已启用" : "未启用"}</Badge>
                    <Badge variant={settings.qq.appSecretConfigured ? "outline" : "warning"}>{settings.qq.appSecretConfigured ? "密钥已托管" : "缺少密钥"}</Badge>
                  </div>
                  <CardDescription className="mt-2">这里配置的是 QQ 互联网站应用，用于用户登录与注册，不是 QQ 机器人 AppID。</CardDescription>
                </div>
                <div className="flex shrink-0 items-center justify-between gap-4 rounded-md border bg-muted/20 px-3 py-2 sm:justify-start">
                  <span className="text-xs font-medium">开放 QQ 登录</span>
                  <Switch checked={settings.qq.enabled} onCheckedChange={(enabled) => setSettings({ ...settings, qq: { ...settings.qq, enabled } })} aria-label="启用 QQ 登录" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <section className="grid gap-5 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="space-y-4">
                  <label className="space-y-2">
                    <span className="block text-xs font-medium">QQ 互联 AppID</span>
                    <Input className="h-10 mono-data" value={settings.qq.appId} onChange={(event) => setSettings({ ...settings, qq: { ...settings.qq, appId: event.target.value } })} placeholder="填写 QQ 互联网站应用 AppID" />
                  </label>
                  <label className="space-y-2">
                    <span className="block text-xs font-medium">App Secret</span>
                    <Input className="h-10" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={settings.qq.appSecretConfigured ? "已配置，留空保持不变；输入新值将轮换" : "请输入 App Secret"} />
                  </label>
                  <label className="space-y-2">
                    <span className="block text-xs font-medium">授权回调地址</span>
                    <div className="flex gap-2">
                      <Input className="h-10 mono-data text-xs" value={settings.qq.redirectUri} onChange={(event) => setSettings({ ...settings, qq: { ...settings.qq, redirectUri: event.target.value } })} placeholder="https://example.com/api/auth/qq/callback" />
                      <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0" disabled={!settings.qq.redirectUri} onClick={() => void copyQQCallback()} aria-label="复制回调地址"><Copy size={15} /></Button>
                    </div>
                    <span className="block text-[11px] leading-5 text-muted-foreground">需与 QQ 互联后台填写的回调地址完全一致；域名、协议和路径任一不同都会导致回调失败。</span>
                  </label>
                </div>
                <div className="rounded-md border bg-muted/20 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={15} />启用前检查</div>
                  <div className="mt-4 space-y-3 text-xs">
                    {[
                      ["AppID", Boolean(settings.qq.appId)],
                      ["App Secret", settings.qq.appSecretConfigured || Boolean(secret)],
                      ["回调地址", Boolean(settings.qq.redirectUri)],
                    ].map(([label, ready]) => (
                      <div key={String(label)} className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">{String(label)}</span>
                        <Badge variant={ready ? "success" : "warning"}>{ready ? "就绪" : "待配置"}</Badge>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 rounded-md border bg-background px-3 py-3 text-[11px] leading-5 text-muted-foreground">
                    密钥只会加密保存到服务端；配置读取接口不会回显原始 Secret。
                  </div>
                </div>
              </section>
              <div className="flex flex-col gap-3 border-t bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <p className="text-xs leading-5 text-muted-foreground">保存后，登录页会根据启用状态展示或禁用 QQ 登录入口。</p>
                <Button className="h-10 shrink-0 sm:min-w-40" onClick={() => void run("qq", saveQQ, "QQ 登录设置已保存")} disabled={busy === "qq"}>
                  {busy === "qq" ? <LoaderCircle className="animate-spin" size={14} /> : <KeyRound size={14} />}
                  {busy === "qq" ? "正在保存" : "保存 QQ 登录设置"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </Tabs.Content>

        <Tabs.Content value="email" className="outline-none">
          <Card className="max-w-4xl overflow-hidden">
            <CardHeader className="border-b px-5 py-5 sm:px-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="flex items-center gap-2"><Mail size={15} />邮箱验证码与 SMTP</CardTitle>
                    <Badge variant={settings.email.smtpPassConfigured ? "outline" : "warning"}>{settings.email.smtpPassConfigured ? "SMTP 密码已托管" : "缺少 SMTP 密码"}</Badge>
                  </div>
                  <CardDescription className="mt-2">控制注册邮箱验证、邮箱验证码登录，以及发送邮件使用的 SMTP 服务。</CardDescription>
                </div>
                <div className="grid shrink-0 gap-2 rounded-md border bg-muted/20 p-3">
                  <label className="flex items-center justify-between gap-4 text-xs font-medium">
                    <span>注册需验证邮箱</span>
                    <Switch checked={settings.email.registrationVerificationEnabled} onCheckedChange={(enabled) => setSettings({ ...settings, email: { ...settings.email, registrationVerificationEnabled: enabled } })} aria-label="启用注册邮箱验证" />
                  </label>
                  <label className="flex items-center justify-between gap-4 text-xs font-medium">
                    <span>邮箱验证码登录</span>
                    <Switch checked={settings.email.loginEnabled} onCheckedChange={(enabled) => setSettings({ ...settings, email: { ...settings.email, loginEnabled: enabled } })} aria-label="启用邮箱验证码登录" />
                  </label>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <section className="grid gap-5 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 md:col-span-2">
                    <span className="block text-xs font-medium">SMTP 服务器</span>
                    <Input className="h-10 mono-data" value={settings.email.smtpHost} onChange={(event) => setSettings({ ...settings, email: { ...settings.email, smtpHost: event.target.value } })} placeholder="smtp.example.com" />
                  </label>
                  <label className="space-y-2">
                    <span className="block text-xs font-medium">端口</span>
                    <Input className="h-10 mono-data" type="number" min={1} max={65535} value={settings.email.smtpPort} onChange={(event) => setSettings({ ...settings, email: { ...settings.email, smtpPort: Number(event.target.value) || 587 } })} />
                  </label>
                  <label className="space-y-2">
                    <span className="block text-xs font-medium">发件邮箱</span>
                    <Input className="h-10 mono-data" type="email" value={settings.email.smtpFrom} onChange={(event) => setSettings({ ...settings, email: { ...settings.email, smtpFrom: event.target.value } })} placeholder="bot@example.com" />
                  </label>
                  <label className="space-y-2">
                    <span className="block text-xs font-medium">SMTP 用户名</span>
                    <Input className="h-10 mono-data" value={settings.email.smtpUser} onChange={(event) => setSettings({ ...settings, email: { ...settings.email, smtpUser: event.target.value } })} placeholder="通常为发件邮箱或账号名" />
                  </label>
                  <label className="space-y-2">
                    <span className="block text-xs font-medium">SMTP 密码</span>
                    <Input className="h-10" type="password" value={smtpPass} onChange={(event) => setSmtpPass(event.target.value)} placeholder={settings.email.smtpPassConfigured ? "已配置，留空保持不变" : "请输入 SMTP 授权码或密码"} />
                  </label>
                  <div className="flex flex-wrap gap-3 md:col-span-2">
                    <label className="flex h-10 items-center gap-3 rounded-md border bg-muted/20 px-3 text-xs font-medium">
                      <Switch checked={settings.email.smtpSecure} onCheckedChange={(enabled) => setSettings({ ...settings, email: { ...settings.email, smtpSecure: enabled } })} aria-label="启用 SMTPS" />
                      使用 SSL/TLS
                    </label>
                    <label className="flex h-10 items-center gap-3 rounded-md border bg-muted/20 px-3 text-xs font-medium">
                      <Switch checked={settings.email.smtpStarttls} onCheckedChange={(enabled) => setSettings({ ...settings, email: { ...settings.email, smtpStarttls: enabled } })} aria-label="启用 STARTTLS" />
                      STARTTLS
                    </label>
                  </div>
                </div>
                <div className="rounded-md border bg-muted/20 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={15} />启用前检查</div>
                  <div className="mt-4 space-y-3 text-xs">
                    {[
                      ["SMTP 服务器", Boolean(settings.email.smtpHost)],
                      ["发件邮箱", Boolean(settings.email.smtpFrom)],
                      ["SMTP 密码", settings.email.smtpPassConfigured || Boolean(smtpPass)],
                    ].map(([label, ready]) => (
                      <div key={String(label)} className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">{String(label)}</span>
                        <Badge variant={ready ? "success" : "warning"}>{ready ? "就绪" : "待配置"}</Badge>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 rounded-md border bg-background px-3 py-3 text-[11px] leading-5 text-muted-foreground">
                    SMTP 密码会加密保存，接口只返回是否已配置；开启验证码功能后，登录页和注册页会按开关自动调整。
                  </div>
                </div>
              </section>
              <div className="flex flex-col gap-3 border-t bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <p className="text-xs leading-5 text-muted-foreground">保存后，发送验证码接口立即使用当前 SMTP 配置。</p>
                <Button className="h-10 shrink-0 sm:min-w-40" onClick={() => void run("email", saveEmail, "邮箱设置已保存")} disabled={busy === "email"}>
                  {busy === "email" ? <LoaderCircle className="animate-spin" size={14} /> : <Save size={14} />}
                  {busy === "email" ? "正在保存" : "保存邮箱设置"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </Tabs.Content>

        <Tabs.Content value="payment" className="outline-none">
          <Card className="max-w-4xl overflow-hidden">
            <CardHeader className="border-b px-5 py-5 sm:px-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>会员支付</CardTitle>
                    <Badge variant={settings.payment.enabled ? "success" : "secondary"}>{settings.payment.enabled ? "已启用" : "未启用"}</Badge>
                  </div>
                  <CardDescription className="mt-2">配置在线收银、人工审核或仅限开发环境的沙箱支付。</CardDescription>
                </div>
                <div className="flex shrink-0 items-center justify-between gap-4 rounded-md border bg-muted/20 px-3 py-2 sm:justify-start">
                  <span className="text-xs font-medium">开放支付</span>
                  <Switch checked={settings.payment.enabled} onCheckedChange={(enabled) => setSettings({ ...settings, payment: { ...settings.payment, enabled } })} aria-label="启用会员支付" />
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              <section className="space-y-2 px-5 py-6 sm:px-6">
                <div>
                  <div className="text-sm font-semibold">支付方式</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">选择会员订单使用的收款与确认流程。</p>
                </div>
                <Select
                  value={settings.payment.provider}
                  onValueChange={(provider) => setSettings({ ...settings, payment: { ...settings.payment, provider: provider as PaymentProvider } })}
                  options={[{ value: "epay", label: "易支付兼容网关" }, { value: "manual", label: "人工收款审核" }, { value: "sandbox", label: "开发沙箱自动支付" }]}
                  ariaLabel="选择支付模式"
                  className="h-10 sm:max-w-sm"
                />
              </section>

              {settings.payment.provider === "epay" && (
                <section className="border-t px-5 py-6 sm:px-6">
                  <div className="mb-5 flex items-start gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border bg-background text-muted-foreground"><CreditCard size={16} /></div>
                    <div>
                      <div className="text-sm font-semibold">易支付接口</div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">保存商户信息后，密钥只在服务端加密存储。</p>
                    </div>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <label className="space-y-2 md:col-span-2">
                      <span className="block text-xs font-medium">网关提交地址</span>
                      <Input className="h-10" value={settings.payment.epayGatewayUrl} onChange={(event) => setSettings({ ...settings, payment: { ...settings.payment, epayGatewayUrl: event.target.value } })} placeholder="https://pay.example.com/submit.php" />
                    </label>
                    <label className="space-y-2">
                      <span className="block text-xs font-medium">商户 ID</span>
                      <Input className="h-10" value={settings.payment.epayPid} onChange={(event) => setSettings({ ...settings, payment: { ...settings.payment, epayPid: event.target.value } })} />
                    </label>
                    <label className="space-y-2">
                      <span className="block text-xs font-medium">商户密钥</span>
                      <Input className="h-10" type="password" value={epayKey} onChange={(event) => setEpayKey(event.target.value)} placeholder={settings.payment.epayKeyConfigured ? "已配置，留空保持不变" : "请输入商户密钥"} />
                    </label>
                  </div>
                </section>
              )}

              {settings.payment.provider === "manual" && (
                <section className="border-t px-5 py-6 sm:px-6">
                  <label className="space-y-2">
                    <span className="block text-xs font-medium">付款说明</span>
                    <Textarea value={settings.payment.manualInstructions} onChange={(event) => setSettings({ ...settings, payment: { ...settings.payment, manualInstructions: event.target.value } })} className="min-h-32 resize-y" placeholder="填写收款方式、联系渠道和审核说明" />
                  </label>
                </section>
              )}

              {settings.payment.provider === "sandbox" && (
                <section className="border-t px-5 py-6 sm:px-6">
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">沙箱模式创建订单后会立即标记支付成功，仅适合本地开发，生产环境会强制拒绝。</div>
                </section>
              )}

              <div className="flex flex-col gap-3 border-t bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <p className="text-xs leading-5 text-muted-foreground">保存后，新创建的会员订单立即使用当前配置。</p>
                <Button className="h-10 shrink-0 sm:min-w-36" onClick={() => void run("payment", savePayment, "支付设置已保存")} disabled={busy === "payment"}>
                  {busy === "payment" ? <LoaderCircle className="animate-spin" size={14} /> : <Save size={14} />}
                  {busy === "payment" ? "正在保存" : "保存支付设置"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </Tabs.Content>

        <Tabs.Content value="plans" className="outline-none"><div className="grid gap-4 lg:grid-cols-3">{plans.map((plan) => <Card key={plan.id}><CardHeader className="border-b"><div className="flex items-center justify-between"><CardTitle>{plan.name}</CardTitle><Badge variant={plan.id === "free" ? "secondary" : "outline"}>{plan.id}</Badge></div></CardHeader><CardContent className="space-y-3 pt-5"><label><span className="field-label">套餐名称</span><Input value={plan.name} onChange={(event) => setPlans((current) => current.map((item) => item.id === plan.id ? { ...item, name: event.target.value } : item))} /></label><label><span className="field-label">套餐介绍</span><Textarea value={plan.description} onChange={(event) => setPlans((current) => current.map((item) => item.id === plan.id ? { ...item, description: event.target.value } : item))} className="min-h-20 resize-y" /></label><div className="grid grid-cols-3 gap-2"><label><span className="field-label">机器人</span><Input type="number" min={0} value={plan.botQuota} onChange={(event) => setPlans((current) => current.map((item) => item.id === plan.id ? { ...item, botQuota: Number(event.target.value) } : item))} /></label><label><span className="field-label">插件</span><Input type="number" min={0} value={plan.pluginQuota} onChange={(event) => setPlans((current) => current.map((item) => item.id === plan.id ? { ...item, pluginQuota: Number(event.target.value) } : item))} /></label><label><span className="field-label">保留天</span><Input type="number" min={1} value={plan.eventRetentionDays} onChange={(event) => setPlans((current) => current.map((item) => item.id === plan.id ? { ...item, eventRetentionDays: Number(event.target.value) } : item))} /></label></div><div className="grid grid-cols-3 gap-2"><label><span className="field-label">月付 ¥</span><Input type="number" min={0} step="0.01" disabled={plan.id === "free"} value={yuan(plan.monthlyPriceCents)} onChange={(event) => setPlans((current) => current.map((item) => item.id === plan.id ? { ...item, monthlyPriceCents: cents(event.target.value) } : item))} /></label><label><span className="field-label">季付 ¥</span><Input type="number" min={0} step="0.01" disabled={plan.id === "free"} value={yuan(plan.quarterlyPriceCents)} onChange={(event) => setPlans((current) => current.map((item) => item.id === plan.id ? { ...item, quarterlyPriceCents: cents(event.target.value) } : item))} /></label><label><span className="field-label">年付 ¥</span><Input type="number" min={0} step="0.01" disabled={plan.id === "free"} value={yuan(plan.yearlyPriceCents)} onChange={(event) => setPlans((current) => current.map((item) => item.id === plan.id ? { ...item, yearlyPriceCents: cents(event.target.value) } : item))} /></label></div><label><span className="field-label">权益（每行一项）</span><Textarea value={plan.features.join("\n")} onChange={(event) => setPlans((current) => current.map((item) => item.id === plan.id ? { ...item, features: event.target.value.split("\n").map((value) => value.trim()).filter(Boolean) } : item))} className="min-h-28 resize-y" /></label><Button className="w-full" variant="outline" disabled={busy === `plan:${plan.id}`} onClick={() => void run(`plan:${plan.id}`, () => savePlan(plan), `${plan.name}已保存`)}><Save size={14} />保存套餐</Button></CardContent></Card>)}</div></Tabs.Content>

        <Tabs.Content value="orders" className="outline-none"><Card className="overflow-hidden"><CardHeader className="border-b"><CardTitle>会员订单审核</CardTitle><CardDescription>人工收款模式下确认到账后发放会员；在线支付订单由回调自动确认。</CardDescription></CardHeader>{orders.length ? <div className="divide-y">{orders.map((order) => <div key={order.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_120px_110px_120px] lg:items-center"><div><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{order.planName} · {cycleLabels[order.billingCycle]}</span><Badge variant={order.status === "paid" ? "success" : order.status === "pending" ? "warning" : "outline"}>{order.status}</Badge></div><div className="mono-data mt-1 text-[10px] text-muted-foreground">{order.orderNo}</div></div><div className="text-xs">{order.provider}</div><div className="mono-data text-sm font-semibold">¥{yuan(order.amountCents)}</div><Button size="sm" disabled={order.status !== "pending" || busy === `order:${order.id}`} onClick={() => void run(`order:${order.id}`, () => confirmOrder(order), "订单已确认并发放会员")}><Check size={14} />确认到账</Button></div>)}</div> : <div className="p-10 text-center text-xs text-muted-foreground">暂无会员订单</div>}</Card></Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
