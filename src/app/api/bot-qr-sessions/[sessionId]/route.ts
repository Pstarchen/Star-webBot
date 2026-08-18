import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getQrSession } from "@/lib/qq-bot-qr-connect";

export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  try {
    return NextResponse.json({ session: getQrSession(user, (await context.params).sessionId) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "扫码会话不存在" }, { status: 404 });
  }
}
