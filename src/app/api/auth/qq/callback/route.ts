import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { completeQQLogin } from "@/lib/qq-login";
import { createSessionToken, deleteSessionsForUser, sessionCookieName, sessionMaxAgeSeconds } from "@/lib/session";
import { getQQLoginConfig } from "@/lib/system-settings-service";

const stateCookie = "starbot_qq_oauth_state";

function redirectUri(request: Request) {
  return getQQLoginConfig().redirectUri || new URL("/api/auth/qq/callback", request.url).toString();
}

function clearStateCookie(response: NextResponse) {
  response.cookies.set(stateCookie, "", { path: "/api/auth/qq/callback", maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  const loginUrl = new URL("/login", request.url);
  const code = request.nextUrl.searchParams.get("code") || "";
  const state = request.nextUrl.searchParams.get("state") || "";
  const cookieState = request.cookies.get(stateCookie)?.value || "";
  if (!code || !state || !cookieState) {
    loginUrl.searchParams.set("error", "qq_callback_invalid");
    return clearStateCookie(NextResponse.redirect(loginUrl));
  }

  try {
    const user = await completeQQLogin(code, state, cookieState, redirectUri(request));
    deleteSessionsForUser(user.id);
    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.set(sessionCookieName, createSessionToken(user), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: sessionMaxAgeSeconds,
    });
    return clearStateCookie(response);
  } catch {
    loginUrl.searchParams.set("error", "qq_login_failed");
    return clearStateCookie(NextResponse.redirect(loginUrl));
  }
}
