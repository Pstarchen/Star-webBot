import { NextResponse } from "next/server";
import { cancelQrSession } from "@/lib/qq-bot-qr-connect";
import { getSession } from "@/lib/session";
import { assertTrustedRequest } from "@/lib/security";

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  try {
    return NextResponse.json({ session: cancelQrSession(user, (await context.params).sessionId) });
  } catch {
    return NextResponse.json({ message: "扫码会话不存在" }, { status: 404 });
  }
}
