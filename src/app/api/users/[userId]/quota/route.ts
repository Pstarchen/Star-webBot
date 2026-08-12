import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { updateUserQuota } from "@/lib/user-service";
import { assertTrustedRequest } from "@/lib/security";

const schema = z.object({ botQuota: z.number().int().min(0).max(999) });

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "配额参数不合法" }, { status: 400 });
  try {
    updateUserQuota(user, (await context.params).userId, parsed.data.botQuota);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_REQUIRED") return NextResponse.json({ message: "仅管理员可以修改配额" }, { status: 403 });
    if (error instanceof Error && error.message === "QUOTA_BELOW_USAGE") return NextResponse.json({ message: "配额不能低于该用户当前已添加的机器人数量" }, { status: 409 });
    return NextResponse.json({ message: "用户不存在" }, { status: 404 });
  }
}
