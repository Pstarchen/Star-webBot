import { NextResponse } from "next/server";
import { z } from "zod";
import { createMembershipOrder, listMembershipOrders } from "@/lib/membership-service";
import { assertTrustedRequest } from "@/lib/security";
import { getSession } from "@/lib/session";

const schema = z.object({
  planId: z.enum(["pro", "team"]),
  billingCycle: z.enum(["monthly", "quarterly", "yearly"]),
  paymentChannel: z.enum(["alipay", "wxpay", "qqpay", "manual", "sandbox"]),
});

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  try { return NextResponse.json({ orders: listMembershipOrders(user) }); }
  catch { return NextResponse.json({ message: "需要管理员权限" }, { status: 403 }); }
}

export async function POST(request: Request) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "订单参数不合法" }, { status: 400 });
  const origin = new URL(request.url).origin;
  try {
    const result = createMembershipOrder(user, { ...parsed.data, returnUrl: `${origin}/`, notifyUrl: `${origin}/api/payments/epay/notify` });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const messages: Record<string, string> = {
      PAYMENT_DISABLED: "管理员尚未启用支付",
      PLAN_PRICE_NOT_CONFIGURED: "该套餐周期尚未设置价格",
      PAYMENT_SANDBOX_PRODUCTION_DISABLED: "生产环境不能使用沙箱支付",
    };
    return NextResponse.json({ message: messages[code] || "订单创建失败" }, { status: code === "PLAN_NOT_FOUND" ? 404 : 400 });
  }
}
