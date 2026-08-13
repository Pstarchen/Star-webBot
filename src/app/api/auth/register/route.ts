import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeEmailVerificationCode } from "@/lib/email-code-service";
import { RateLimitError, assertTrustedRequest, consumeRateLimit, rateLimitKey } from "@/lib/security";
import { createSessionToken, registerUser, sessionCookieName, sessionMaxAgeSeconds } from "@/lib/session";
import { getEmailConfig } from "@/lib/system-settings-service";

const schema = z.object({
  name: z.string().trim().min(2).max(40),
  email: z.email().max(160),
  password: z.string().min(8).max(128),
  code: z.string().regex(/^\d{6}$/).optional(),
});

export async function POST(request: Request) {
  try {
    assertTrustedRequest(request);
  } catch {
    return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "注册参数不合法", issues: parsed.error.issues }, { status: 400 });

  try {
    consumeRateLimit(rateLimitKey(request, "auth.register", parsed.data.email), 5, 60 * 60 * 1000);
    if (getEmailConfig().registrationVerificationEnabled) {
      if (!parsed.data.code) return NextResponse.json({ message: "请先完成邮箱验证码验证" }, { status: 400 });
      consumeEmailVerificationCode({ email: parsed.data.email, purpose: "register", code: parsed.data.code });
    }
    const user = registerUser(parsed.data);
    const response = NextResponse.json({ user }, { status: 201 });
    response.cookies.set(sessionCookieName, createSessionToken(user), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: sessionMaxAgeSeconds,
    });
    return response;
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json({ message: "注册尝试过于频繁，请稍后再试" }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    }
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return NextResponse.json({ message: "该邮箱已注册" }, { status: 409 });
    }
    if (error instanceof Error && error.message === "EMAIL_CODE_TOO_MANY_ATTEMPTS") {
      return NextResponse.json({ message: "验证码尝试次数过多，请重新获取" }, { status: 429 });
    }
    if (error instanceof Error && error.message === "EMAIL_CODE_INVALID") {
      return NextResponse.json({ message: "邮箱验证码不正确或已过期" }, { status: 400 });
    }
    return NextResponse.json({ message: "注册失败" }, { status: 500 });
  }
}
