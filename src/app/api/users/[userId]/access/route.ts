import { NextResponse } from "next/server";
import { z } from "zod";
import { gatewayManager } from "@/lib/gateway-manager";
import { listBotIdsForUser } from "@/lib/bot-service";
import { assertTrustedRequest } from "@/lib/security";
import { getSession } from "@/lib/session";
import { updateUserAccess } from "@/lib/user-service";

const schema = z.object({
  role: z.enum(["admin", "developer", "operator"]),
  status: z.enum(["active", "suspended"]),
});

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "账号权限参数不合法" }, { status: 400 });
  const userId = (await context.params).userId;
  try {
    const result = updateUserAccess(user, userId, parsed.data);
    if (result.status === "suspended") listBotIdsForUser(userId).forEach((botId) => gatewayManager.disconnect(botId, true, true));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_REQUIRED") return NextResponse.json({ message: "需要管理员权限" }, { status: 403 });
    if (error instanceof Error && error.message === "SELF_ADMIN_PROTECTION") return NextResponse.json({ message: "不能停用或降级当前管理员账号" }, { status: 409 });
    if (error instanceof Error && error.message === "LAST_ADMIN_PROTECTION") return NextResponse.json({ message: "系统必须保留至少一位有效管理员" }, { status: 409 });
    return NextResponse.json({ message: "用户不存在" }, { status: 404 });
  }
}
