"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Eye, EyeOff, FileImage, HardDrive, LoaderCircle, LockKeyhole, Network, ServerCog, Settings2, ShieldCheck, TestTube2 } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FilePicker } from "@/components/ui/file-picker";
import { Input, Textarea } from "@/components/ui/input";
import { SITE_ASSET_MAX_BYTES, SITE_ASSET_MAX_LABEL } from "@/lib/site-assets";
import type { SitePublicSettings } from "@/types/platform";

type DatabaseSetup = {
  provider: "sqlite" | "mysql";
  locked: boolean;
  sqlitePath: string;
  mysql: { host: string; port: number; user: string; database: string; ssl: boolean };
};

function fileToDataUrl(file: File | null) {
  if (!file) return Promise.resolve(undefined);
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

export function InstallSetupForm({ site, database }: { site: SitePublicSettings; database: DatabaseSetup }) {
  const router = useRouter();
  const [siteName, setSiteName] = useState(site.siteName);
  const [siteTagline, setSiteTagline] = useState(site.siteTagline);
  const [siteDescription, setSiteDescription] = useState(site.siteDescription);
  const [adminName, setAdminName] = useState("系统管理员");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [databaseProvider, setDatabaseProvider] = useState<"sqlite" | "mysql">(database.provider);
  const [sqlitePath, setSqlitePath] = useState(database.sqlitePath);
  const [mysqlHost, setMysqlHost] = useState(database.mysql.host);
  const [mysqlPort, setMysqlPort] = useState(database.mysql.port);
  const [mysqlUser, setMysqlUser] = useState(database.mysql.user);
  const [mysqlPassword, setMysqlPassword] = useState("");
  const [mysqlDatabase, setMysqlDatabase] = useState(database.mysql.database);
  const [mysqlSsl, setMysqlSsl] = useState(database.mysql.ssl);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testingDatabase, setTestingDatabase] = useState(false);
  const [databaseStatus, setDatabaseStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState("");

  function databaseInput() {
    return { provider: databaseProvider, sqlitePath, mysqlHost, mysqlPort, mysqlUser, mysqlPassword, mysqlDatabase, mysqlSsl };
  }

  function selectProvider(provider: "sqlite" | "mysql") {
    if (database.locked) return;
    setDatabaseProvider(provider);
    setDatabaseStatus(null);
  }

  async function testDatabase() {
    setTestingDatabase(true);
    setDatabaseStatus(null);
    try {
      const response = await fetch("/api/install/database-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(databaseInput()),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message || "数据库连接测试失败");
      setDatabaseStatus({ success: true, message: body.message || "数据库连接测试通过" });
    } catch (testError) {
      setDatabaseStatus({ success: false, message: testError instanceof Error ? testError.message : "数据库连接测试失败" });
    } finally {
      setTestingDatabase(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const [logoDataUrl, faviconDataUrl] = await Promise.all([fileToDataUrl(logoFile), fileToDataUrl(faviconFile)]);
      const response = await fetch("/api/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteName, siteTagline, siteDescription, adminName, adminEmail, adminPassword, database: databaseInput(), logoDataUrl, faviconDataUrl }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message || "初始化失败");
      router.replace("/console");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "初始化失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-muted/40 px-4 py-8">
      <div className="absolute inset-x-0 top-0 h-px bg-foreground" />
      <div className="mx-auto max-w-5xl">
        <div className="mb-7 flex items-center justify-between gap-4">
          <BrandMark site={{ ...site, siteName, siteTagline }} />
          <div className="hidden items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs font-medium text-muted-foreground sm:flex">
            <ShieldCheck size={14} />首次初始化
          </div>
        </div>

        <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="overflow-hidden shadow-sm">
            <CardHeader className="border-b px-5 py-5 sm:px-6">
              <CardTitle className="flex items-center gap-2"><Settings2 size={16} />安装导引</CardTitle>
              <CardDescription>选择持久化方式，完成连接校验后创建站点与第一个系统管理员。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 px-5 py-6 sm:px-6">
              <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-sm font-semibold">数据持久化</div><p className="mt-1 text-xs leading-5 text-muted-foreground">SQLite 适合单机快速部署；MySQL 适合独立数据库服务和多实例运行。</p></div>{database.locked && <span className="inline-flex items-center gap-1.5 rounded-md border bg-muted px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground"><LockKeyhole size={12} />环境变量托管</span>}</div>
                <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="选择数据库类型">
                  {([
                    ["sqlite", "SQLite", "内置文件数据库", HardDrive],
                    ["mysql", "MySQL", "独立关系型数据库", ServerCog],
                  ] as const).map(([provider, name, description, Icon]) => {
                    const selected = databaseProvider === provider;
                    return <button key={provider} type="button" role="radio" aria-checked={selected} disabled={database.locked} onClick={() => selectProvider(provider)} className={`flex min-h-22 items-start gap-3 rounded-md border p-4 text-left transition-colors ${selected ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-muted/50"} disabled:cursor-default disabled:opacity-100`}><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md border ${selected ? "border-background/25 bg-background/10" : "bg-muted"}`}><Icon size={16} /></span><span><span className="block text-sm font-semibold">{name}</span><span className={`mt-1 block text-[11px] leading-5 ${selected ? "text-background/70" : "text-muted-foreground"}`}>{description}</span></span></button>;
                  })}
                </div>
                {databaseProvider === "sqlite" ? <label className="block"><span className="field-label">数据库文件路径</span><Input value={sqlitePath} onChange={(event) => { setSqlitePath(event.target.value); setDatabaseStatus(null); }} disabled={database.locked} className="mono-data text-xs" placeholder="./data/starbot.db" required /></label> : <div className="grid gap-4 md:grid-cols-2">
                  <label className="block"><span className="field-label">MySQL 主机</span><Input value={mysqlHost} onChange={(event) => { setMysqlHost(event.target.value); setDatabaseStatus(null); }} disabled={database.locked} className="mono-data text-xs" placeholder="127.0.0.1" required /></label>
                  <label className="block"><span className="field-label">端口</span><Input value={mysqlPort} onChange={(event) => { setMysqlPort(Number(event.target.value) || 3306); setDatabaseStatus(null); }} disabled={database.locked} type="number" min={1} max={65535} className="mono-data text-xs" required /></label>
                  <label className="block"><span className="field-label">用户名</span><Input value={mysqlUser} onChange={(event) => { setMysqlUser(event.target.value); setDatabaseStatus(null); }} disabled={database.locked} autoComplete="username" className="mono-data text-xs" placeholder="starbot" required /></label>
                  <label className="block"><span className="field-label">数据库名</span><Input value={mysqlDatabase} onChange={(event) => { setMysqlDatabase(event.target.value); setDatabaseStatus(null); }} disabled={database.locked} className="mono-data text-xs" placeholder="starbot" required /></label>
                  {!database.locked && <label className="block md:col-span-2"><span className="field-label">MySQL 密码</span><Input value={mysqlPassword} onChange={(event) => { setMysqlPassword(event.target.value); setDatabaseStatus(null); }} type="password" autoComplete="new-password" placeholder="仅用于本次连接测试和加密保存" required /></label>}
                  <label className="flex items-center gap-3 text-xs font-medium md:col-span-2"><input type="checkbox" checked={mysqlSsl} onChange={(event) => { setMysqlSsl(event.target.checked); setDatabaseStatus(null); }} disabled={database.locked} className="h-4 w-4 rounded border-input" />使用 TLS/SSL 加密连接</label>
                </div>}
                <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" onClick={() => void testDatabase()} disabled={testingDatabase || loading}><TestTube2 size={15} />{testingDatabase ? "正在测试..." : "测试连接"}</Button>{databaseStatus && <span className={`inline-flex items-center gap-1.5 text-xs ${databaseStatus.success ? "text-emerald-700" : "text-red-700"}`}>{databaseStatus.success ? <CheckCircle2 size={14} /> : <Network size={14} />}{databaseStatus.message}</span>}</div>
              </section>

              <section className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="block text-xs font-medium">站点名称</span>
                  <Input value={siteName} onChange={(event) => setSiteName(event.target.value)} required minLength={2} maxLength={40} />
                </label>
                <label className="space-y-2">
                  <span className="block text-xs font-medium">短标语</span>
                  <Input value={siteTagline} onChange={(event) => setSiteTagline(event.target.value)} maxLength={80} />
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="block text-xs font-medium">站点介绍</span>
                  <Textarea value={siteDescription} onChange={(event) => setSiteDescription(event.target.value)} required minLength={10} maxLength={300} className="min-h-28 resize-y" />
                </label>
              </section>

              <section className="grid gap-4 border-t pt-5 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="block text-xs font-medium">管理员姓名</span>
                  <Input value={adminName} onChange={(event) => setAdminName(event.target.value)} autoComplete="name" required minLength={2} maxLength={40} />
                </label>
                <label className="space-y-2">
                  <span className="block text-xs font-medium">管理员邮箱</span>
                  <Input type="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} autoComplete="email" required />
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="block text-xs font-medium">管理员密码</span>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={adminPassword}
                      onChange={(event) => setAdminPassword(event.target.value)}
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={128}
                      required
                      className="pr-10"
                    />
                    <Button type="button" variant="ghost" size="icon" onClick={() => setShowPassword((value) => !value)} className="absolute right-0 top-0 h-9 w-9 text-muted-foreground" aria-label={showPassword ? "隐藏密码" : "显示密码"}>
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </Button>
                  </div>
                </label>
              </section>

              {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</div>}
              <Button type="submit" className="h-10 justify-center sm:w-fit" disabled={loading}>
                {loading ? <LoaderCircle className="animate-spin" size={15} /> : <LockKeyhole size={15} />}
                {loading ? "正在初始化" : "完成初始化"}
                {!loading && <ArrowRight size={15} />}
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><FileImage size={15} />网站 Logo</CardTitle>
              </CardHeader>
              <CardContent>
                <FilePicker file={logoFile} onFileChange={setLogoFile} accept="image/png,image/jpeg,image/webp" helperText={`最大 ${SITE_ASSET_MAX_LABEL}`} maxBytes={SITE_ASSET_MAX_BYTES} browseLabel="选择图片" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><FileImage size={15} />浏览器图标</CardTitle>
              </CardHeader>
              <CardContent>
                <FilePicker file={faviconFile} onFileChange={setFaviconFile} accept="image/png,image/jpeg,image/webp,image/x-icon" helperText={`最大 ${SITE_ASSET_MAX_LABEL}`} maxBytes={SITE_ASSET_MAX_BYTES} browseLabel="选择图标" />
              </CardContent>
            </Card>
          </div>
        </form>
      </div>
    </main>
  );
}
