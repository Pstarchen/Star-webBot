import { NextResponse } from "next/server";
import { z } from "zod";
import { listMembershipPlans, updateMembershipPlan } from "@/lib/membership-service";
import { assertTrustedRequest } from "@/lib/security";
import { getSession } from "@/lib/session";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  return NextResponse.json({ plans: listMembershipPlans() });
}

const schema = z.object({
  id: z.enum(["free", "pro", "team"]),
  name: z.string().trim().min(2).max(30),
  description: z.string().trim().min(5).max(200),
  botQuota: z.number().int().min(0).max(999),
  pluginQuota: z.number().int().min(0).max(9999),
  eventRetentionDays: z.number().int().min(1).max(3650),
  monthlyPriceCents: z.number().int().min(0).max(10_000_000),
  quarterlyPriceCents: z.number().int().min(0).max(10_000_000),
  yearlyPriceCents: z.number().int().min(0).max(10_000_000),
  features: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
});

export async function PATCH(request: Request) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "套餐参数不合法", issues: parsed.error.issues }, { status: 400 });
  try {
    const { id, ...input } = parsed.data;
    return NextResponse.json({ plan: updateMembershipPlan(user, id, input) });
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_REQUIRED") return NextResponse.json({ message: "需要管理员权限" }, { status: 403 });
    if (error instanceof Error && error.message === "FREE_PLAN_MUST_BE_FREE") return NextResponse.json({ message: "免费版套餐价格必须为零" }, { status: 400 });
    return NextResponse.json({ message: "套餐保存失败" }, { status: 500 });
  }
}
