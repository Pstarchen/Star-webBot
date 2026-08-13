import { NextResponse } from "next/server";
import { z } from "zod";
import { sendEmailVerificationCode } from "@/lib/email-code-service";
import { RateLimitError, assertTrustedRequest, consumeRateLimit, rateLimitKey } from "@/lib/security";
import { getEmailConfig } from "@/lib/system-settings-service";

const schema = z.object({
  email: z.email().max(160),
  purpose: z.enum(["login", "register"]),
});

export async function POST(request: Request) {
  try {
    assertTrustedRequest(request);
  } catch {
    return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "邮箱地址不正确" }, { status: 400 });

  try {
    const config = getEmailConfig();
    if (parsed.data.purpose === "login" && !config.loginEnabled) {
      return NextResponse.json({ message: "管理员尚未开启邮箱验证码登录" }, { status: 403 });
    }
    if (parsed.data.purpose === "register" && !config.registrationVerificationEnabled) {
      return NextResponse.json({ message: "当前注册不需要邮箱验证码" }, { status: 403 });
    }
    consumeRateLimit(rateLimitKey(request, "auth.email_code", `${parsed.data.purpose}:${parsed.data.email}`), 3, 15 * 60 * 1000);
    return NextResponse.json(await sendEmailVerificationCode(parsed.data));
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json({ message: "验证码发送过于频繁，请稍后再试" }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    }
    const code = error instanceof Error ? error.message : "";
    if (code === "EMAIL_CODE_COOLDOWN") return NextResponse.json({ message: "验证码刚刚发送过，请稍后再试" }, { status: 429 });
    if (code === "EMAIL_LOGIN_USER_NOT_FOUND") return NextResponse.json({ message: "该邮箱尚未注册，请先注册账号" }, { status: 404 });
    if (code === "EMAIL_REGISTER_USER_EXISTS") return NextResponse.json({ message: "该邮箱已注册，请切换到登录" }, { status: 409 });
    if (code === "EMAIL_SMTP_NOT_CONFIGURED") return NextResponse.json({ message: "邮件发送服务尚未配置，请联系管理员" }, { status: 503 });
    return NextResponse.json({ message: "验证码发送失败" }, { status: 500 });
  }
}
