import { NextResponse } from "next/server";
import { createQQAuthorization } from "@/lib/qq-login";
import { requestUsesHttps } from "@/lib/security";
import { getQQLoginConfig } from "@/lib/system-settings-service";

const stateCookie = "starbot_qq_oauth_state";

function redirectUri(request: Request) {
  return getQQLoginConfig().redirectUri || new URL("/api/auth/qq/callback", request.url).toString();
}

export async function GET(request: Request) {
  try {
    const authorization = createQQAuthorization(redirectUri(request));
    const response = NextResponse.redirect(authorization.url);
    response.cookies.set(stateCookie, authorization.state, {
      httpOnly: true,
      sameSite: "lax",
      secure: requestUsesHttps(request),
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
