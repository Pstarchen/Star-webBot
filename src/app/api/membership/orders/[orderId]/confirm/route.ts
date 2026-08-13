import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmMembershipOrder } from "@/lib/membership-service";
import { assertTrustedRequest } from "@/lib/security";
import { getSession } from "@/lib/session";

const schema = z.object({ providerTradeNo: z.string().trim().min(1).max(120), note: z.string().trim().max(500).optional() });

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ message: "需要管理员权限" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "支付确认参数不合法" }, { status: 400 });
  try { return NextResponse.json(confirmMembershipOrder(user, (await context.params).orderId, parsed.data.providerTradeNo, parsed.data.note)); }
  catch { return NextResponse.json({ message: "订单不存在或不可确认" }, { status: 409 }); }
}
