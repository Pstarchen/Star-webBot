"use client";

import { useState } from "react";
import { ArrowRight, Eye, EyeOff, FileImage, LoaderCircle, LockKeyhole, Settings2, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FilePicker } from "@/components/ui/file-picker";
import { Input, Textarea } from "@/components/ui/input";
import type { SitePublicSettings } from "@/types/platform";

function fileToDataUrl(file: File | null) {
  if (!file) return Promise.resolve(undefined);
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

export function InstallSetupForm({ site }: { site: SitePublicSettings }) {
  const [siteName, setSiteName] = useState(site.siteName);
  const [siteTagline, setSiteTagline] = useState(site.siteTagline);
  const [siteDescription, setSiteDescription] = useState(site.siteDescription);
  const [adminName, setAdminName] = useState("系统管理员");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const [logoDataUrl, faviconDataUrl] = await Promise.all([fileToDataUrl(logoFile), fileToDataUrl(faviconFile)]);
      const response = await fetch("/api/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteName, siteTagline, siteDescription, adminName, adminEmail, adminPassword, logoDataUrl, faviconDataUrl }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message || "初始化失败");
      window.location.replace("/");
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
              <CardDescription>设置站点资料与第一个系统管理员。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 px-5 py-6 sm:px-6">
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
                <FilePicker file={logoFile} onFileChange={setLogoFile} accept="image/png,image/jpeg,image/webp" helperText="最大 512KB" browseLabel="选择图片" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><FileImage size={15} />浏览器图标</CardTitle>
              </CardHeader>
              <CardContent>
                <FilePicker file={faviconFile} onFileChange={setFaviconFile} accept="image/png,image/jpeg,image/webp,image/x-icon" helperText="最大 512KB" browseLabel="选择图标" />
              </CardContent>
            </Card>
          </div>
        </form>
      </div>
    </main>
  );
}
