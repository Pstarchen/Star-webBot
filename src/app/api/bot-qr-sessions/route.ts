import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { assertTrustedRequest } from "@/lib/security";
import { startQrSession } from "@/lib/qq-bot-qr-connect";

const startSchema = z.object({
  environment: z.enum(["production", "sandbox"]),
  connectionMode: z.enum(["websocket", "webhook"]),
});

export async function POST(request: Request) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "扫码参数不合法" }, { status: 400 });
  try {
    return NextResponse.json({ session: startQrSession(user, parsed.data) }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "QQ_BOT_QR_START_FAILED";
    if (code === "QQ_BOT_QR_ALREADY_ACTIVE") return NextResponse.json({ message: "已有一个扫码会话正在进行，请先完成或取消它" }, { status: 409 });
    return NextResponse.json({ message: "扫码会话创建失败" }, { status: 500 });
  }
}
