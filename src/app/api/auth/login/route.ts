import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeEmailVerificationCode } from "@/lib/email-code-service";
import { RateLimitError, assertTrustedRequest, consumeRateLimit, rateLimitKey, requestUsesHttps } from "@/lib/security";
import { authenticate, authenticateWithEmail, createSessionToken, deleteCurrentSession, deleteSessionsForUser, sessionCookieName, sessionMaxAgeSeconds } from "@/lib/session";
import { getEmailConfig } from "@/lib/system-settings-service";

const passwordSchema = z.object({
  method: z.literal("password").optional(),
  email: z.email().max(160),
  password: z.string().min(1).max(128),
});

const codeSchema = z.object({
  method: z.literal("email_code"),
  email: z.email().max(160),
  code: z.string().regex(/^\d{6}$/),
});

const schema = z.union([passwordSchema, codeSchema]);

export async function POST(request: Request) {
  try {
    assertTrustedRequest(request);
  } catch {
    return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "邮箱或密码不正确" }, { status: 401 });

  try {
    consumeRateLimit(rateLimitKey(request, "auth.login", parsed.data.email), 10, 15 * 60 * 1000);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json({ message: "登录尝试过于频繁，请稍后再试" }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    }
    throw error;
  }

  let user = null;
  try {
    if (parsed.data.method === "email_code" && !getEmailConfig().loginEnabled) {
      return NextResponse.json({ message: "管理员尚未开启邮箱验证码登录" }, { status: 403 });
    }
    user = parsed.data.method === "email_code"
      ? (() => {
        consumeEmailVerificationCode({ email: parsed.data.email, purpose: "login", code: parsed.data.code });
        return authenticateWithEmail(parsed.data.email);
      })()
      : authenticate(parsed.data.email, parsed.data.password);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "EMAIL_CODE_TOO_MANY_ATTEMPTS") return NextResponse.json({ message: "验证码尝试次数过多，请重新获取" }, { status: 429 });
    if (code === "EMAIL_CODE_INVALID") return NextResponse.json({ message: "邮箱验证码不正确或已过期" }, { status: 401 });
    throw error;
  }

  if (!user) {
    return NextResponse.json({ message: parsed.data.method === "email_code" ? "邮箱验证码不正确或已过期" : "邮箱或密码不正确" }, { status: 401 });
  }

  await deleteCurrentSession();
  deleteSessionsForUser(user.id);
  const response = NextResponse.json({ user });
  response.cookies.set(sessionCookieName, createSessionToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: requestUsesHttps(request),
    path: "/",
    maxAge: sessionMaxAgeSeconds,
  });
  return response;
}
