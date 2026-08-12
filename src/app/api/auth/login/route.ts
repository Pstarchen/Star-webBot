import { NextResponse } from "next/server";
import { z } from "zod";
import { RateLimitError, assertTrustedRequest, consumeRateLimit, rateLimitKey } from "@/lib/security";
import { authenticate, createSessionToken, deleteCurrentSession, deleteSessionsForUser, sessionCookieName, sessionMaxAgeSeconds } from "@/lib/session";

const schema = z.object({
  email: z.email().max(160),
  password: z.string().min(1).max(128),
});

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

  const user = authenticate(parsed.data.email, parsed.data.password);

  if (!user) {
    return NextResponse.json({ message: "邮箱或密码不正确" }, { status: 401 });
  }

  await deleteCurrentSession();
  deleteSessionsForUser(user.id);
  const response = NextResponse.json({ user });
  response.cookies.set(sessionCookieName, createSessionToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionMaxAgeSeconds,
  });
  return response;
}
