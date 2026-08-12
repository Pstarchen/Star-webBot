import { NextResponse } from "next/server";
import { createQQAuthorization } from "@/lib/qq-login";

const stateCookie = "starbot_qq_oauth_state";

function redirectUri(request: Request) {
  return process.env.QQ_LOGIN_REDIRECT_URI || new URL("/api/auth/qq/callback", request.url).toString();
}

export async function GET(request: Request) {
  try {
    const authorization = createQQAuthorization(redirectUri(request));
    const response = NextResponse.redirect(authorization.url);
    response.cookies.set(stateCookie, authorization.state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth/qq/callback",
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", error instanceof Error && error.message === "QQ_LOGIN_NOT_CONFIGURED" ? "qq_not_configured" : "qq_start_failed");
    return NextResponse.redirect(url);
  }
}

export { stateCookie as qqOAuthStateCookie };
