import { NextResponse } from "next/server";
import { assertTrustedRequest } from "@/lib/security";
import { deleteCurrentSession, sessionCookieName } from "@/lib/session";

export async function POST(request: Request) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  await deleteCurrentSession();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookieName, "", { path: "/", maxAge: 0 });
  return response;
}
