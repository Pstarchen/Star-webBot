"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Tabs from "@radix-ui/react-tabs";
import { ArrowRight, Eye, EyeOff, LockKeyhole, MessageCircle } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function LoginForm({ qqLoginEnabled, initialError = "" }: { qqLoginEnabled: boolean; initialError?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) {
        throw new Error(body.message || (mode === "login" ? "登录失败，请稍后重试" : "注册失败，请稍后重试"));
      }
      router.push("/");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "认证请求失败");
    } finally {
      setLoading(false);
    }
  }

  function changeMode(value: string) {
    setMode(value as "login" | "register");
    setError("");
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-muted/40 px-4 py-10">
      <div className="absolute inset-x-0 top-0 h-px bg-foreground" />
      <div className="w-full max-w-[420px]">
        <div className="mb-7 flex justify-center">
          <BrandMark />
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

              {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</div>}

              <Button type="submit" className="h-10 w-full" disabled={loading}>
                {loading ? "正在处理..." : mode === "login" ? "进入控制台" : "注册并进入"}
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

        <p className="mt-5 text-center text-xs text-muted-foreground">QQ 官方机器人管理与开发平台</p>
      </div>
    </main>
  );
}
