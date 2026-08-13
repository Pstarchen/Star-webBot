"use client";

import { useEffect, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole, Mail, MessageCircle } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SiteFooter } from "@/components/site-footer";
import type { SitePublicSettings } from "@/types/platform";

export function LoginForm({ qqLoginEnabled, site, initialError = "" }: { qqLoginEnabled: boolean; site: SitePublicSettings; initialError?: string }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loginMethod, setLoginMethod] = useState<"password" | "email_code">("password");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!codeCooldown) return;
    const timer = window.setInterval(() => setCodeCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [codeCooldown]);

  const usesEmailCode = mode === "register" || loginMethod === "email_code";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const payload = mode === "login"
        ? loginMethod === "email_code"
          ? { method: "email_code", email, code }
          : { method: "password", email, password }
        : { name, email, password, code };
      const response = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) {
        throw new Error(body.message || (mode === "login" ? "登录失败，请稍后重试" : "注册失败，请稍后重试"));
      }
      window.location.replace("/");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "认证请求失败");
    } finally {
      setLoading(false);
    }
  }

  function changeMode(value: string) {
    setMode(value as "login" | "register");
    setError("");
    setNotice("");
    setCode("");
  }

  async function sendCode() {
    if (!email.trim() || codeCooldown || sendingCode) return;
    setSendingCode(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/auth/email-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, purpose: mode }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string; cooldownSeconds?: number };
      if (!response.ok) throw new Error(body.message || "验证码发送失败");
      setCodeCooldown(body.cooldownSeconds || 60);
      setNotice("验证码已发送，请查看邮箱。");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "验证码发送失败");
    } finally {
      setSendingCode(false);
    }
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-muted/40 px-4 py-10">
      <div className="absolute inset-x-0 top-0 h-px bg-foreground" />
      <div className="w-full max-w-[420px]">
        <div className="mb-7 flex justify-center">
          <BrandMark site={site} />
        </div>

        <Card className="shadow-lg">
          <CardHeader className="px-6 pb-4 pt-6 text-center sm:px-8 sm:pt-8">
            <div className="mx-auto mb-4 grid h-9 w-9 place-items-center rounded-lg border bg-muted text-foreground" aria-hidden="true">
              <LockKeyhole size={16} />
            </div>
            <CardTitle className="text-xl">{mode === "login" ? "登录工作区" : "创建工作区账号"}</CardTitle>
            <CardDescription className="mt-1">
              {mode === "login" ? "使用你的账号继续管理 QQ 机器人" : "注册后将获得默认机器人配额"}
            </CardDescription>
          </CardHeader>

          <CardContent className="px-6 pb-6 sm:px-8 sm:pb-8">
            <Tabs.Root value={mode} onValueChange={changeMode}>
              <Tabs.List className="grid h-9 grid-cols-2 rounded-md bg-muted p-1" aria-label="认证方式">
                <Tabs.Trigger value="login" className="rounded-sm text-xs font-medium text-muted-foreground outline-none data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm">
                  登录
                </Tabs.Trigger>
                <Tabs.Trigger value="register" className="rounded-sm text-xs font-medium text-muted-foreground outline-none data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm">
                  注册
                </Tabs.Trigger>
              </Tabs.List>
            </Tabs.Root>

            {mode === "login" && (
              <div className="mt-5 grid grid-cols-2 gap-2 rounded-md border bg-muted/20 p-1">
                <button
                  type="button"
                  onClick={() => { setLoginMethod("password"); setError(""); setNotice(""); }}
                  className={loginMethod === "password" ? "flex h-8 items-center justify-center gap-2 rounded-sm bg-card text-xs font-medium shadow-sm" : "flex h-8 items-center justify-center gap-2 rounded-sm text-xs font-medium text-muted-foreground hover:bg-accent"}
                >
                  <LockKeyhole size={13} />密码
                </button>
                <button
                  type="button"
                  onClick={() => { setLoginMethod("email_code"); setError(""); setNotice(""); }}
                  className={loginMethod === "email_code" ? "flex h-8 items-center justify-center gap-2 rounded-sm bg-card text-xs font-medium shadow-sm" : "flex h-8 items-center justify-center gap-2 rounded-sm text-xs font-medium text-muted-foreground hover:bg-accent"}
                >
                  <Mail size={13} />邮箱验证码
                </button>
              </div>
            )}

            <form onSubmit={submit} className="mt-6 space-y-4">
              {mode === "register" && (
                <label className="block">
                  <span className="field-label">姓名</span>
                  <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" minLength={2} placeholder="你的姓名" required />
                </label>
              )}
              <label className="block">
                <span className="field-label">邮箱地址</span>
                <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="name@example.com" required />
              </label>
              {!usesEmailCode || mode === "register" ? (
                <label className="block">
                  <span className="field-label">密码</span>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                      minLength={8}
                      className="pr-10"
                      placeholder="至少 8 位"
                      required
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute right-0 top-0 h-9 w-9 text-muted-foreground"
                      aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </Button>
                  </div>
                </label>
              ) : null}

              {usesEmailCode && (
                <label className="block">
                  <span className="field-label">邮箱验证码</span>
                  <div className="flex gap-2">
                    <Input
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={code}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      autoComplete="one-time-code"
                      className="mono-data"
                      placeholder="6 位数字"
                      required
                    />
                    <Button type="button" variant="outline" className="h-9 shrink-0 px-3 text-xs" disabled={!email.trim() || sendingCode || codeCooldown > 0} onClick={() => void sendCode()}>
                      <KeyRound size={14} />
                      {codeCooldown ? `${codeCooldown}s` : sendingCode ? "发送中" : "发送验证码"}
                    </Button>
                  </div>
                </label>
              )}

              {notice && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">{notice}</div>}
              {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</div>}

              <Button type="submit" className="h-10 w-full" disabled={loading}>
                {loading ? "正在处理..." : mode === "login" ? "进入控制台" : "验证邮箱并注册"}
                {!loading && <ArrowRight size={16} />}
              </Button>
            </form>

            <div className="my-5 flex items-center gap-3 text-[11px] text-muted-foreground"><span className="h-px flex-1 bg-border" />或<span className="h-px flex-1 bg-border" /></div>
            {qqLoginEnabled ? (
              <a href="/api/auth/qq/start" className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-accent">
                <MessageCircle size={16} />使用 QQ 登录
              </a>
            ) : (
              <Button variant="outline" className="h-10 w-full" disabled title="管理员尚未配置 QQ 互联应用">
                <MessageCircle size={16} />QQ 登录未配置
              </Button>
            )}
          </CardContent>
        </Card>

        <p className="mt-5 text-center text-xs text-muted-foreground">{site.siteDescription}</p>
        <SiteFooter site={site} compact />
      </div>
    </main>
  );
}
