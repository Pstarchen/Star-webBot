import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getQrSessionImage } from "@/lib/qq-bot-qr-connect";

export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const user = await getSession();
  if (!user) return new NextResponse("未登录或会话已失效", { status: 401 });
  try {
    const qrUrl = getQrSessionImage(user, (await context.params).sessionId);
    const image = await QRCode.toBuffer(qrUrl, { errorCorrectionLevel: "M", margin: 2, width: 320 });
    return new NextResponse(new Uint8Array(image), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
  } catch {
    return new NextResponse("二维码暂不可用", { status: 404 });
  }
}
