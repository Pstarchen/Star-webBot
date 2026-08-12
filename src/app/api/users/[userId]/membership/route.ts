import { NextResponse } from "next/server";
import { z } from "zod";
import { assignMembershipPlan } from "@/lib/membership-service";
import { getSession } from "@/lib/session";
import { assertTrustedRequest } from "@/lib/security";

const schema = z.object({ planId: z.enum(["free", "pro", "team"]) });

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ message: "需要管理员权限" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "会员套餐参数不合法" }, { status: 400 });

  try {
    return NextResponse.json(assignMembershipPlan(user, (await context.params).userId, parsed.data.planId));
  } catch (error) {
    if (error instanceof Error && error.message === "USER_NOT_FOUND") return NextResponse.json({ message: "用户不存在" }, { status: 404 });
    if (error instanceof Error && error.message === "PLAN_NOT_FOUND") return NextResponse.json({ message: "会员套餐不存在或已停用" }, { status: 404 });
    return NextResponse.json({ message: "会员套餐更新失败" }, { status: 500 });
  }
}
