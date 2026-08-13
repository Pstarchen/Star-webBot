import { NextResponse } from "next/server";
import { z } from "zod";
import { reviewPlugin } from "@/lib/hosted-plugin-service";
import { getSession } from "@/lib/session";
import { assertTrustedRequest } from "@/lib/security";

const schema = z.object({
  approved: z.boolean(),
  note: z.string().trim().max(500).optional(),
  featured: z.boolean().default(false),
});

export async function PATCH(request: Request, context: { params: Promise<{ reviewId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (!parsed.data.approved && !parsed.data.note)) return NextResponse.json({ message: "审核参数不合法，驳回时必须填写原因" }, { status: 400 });
  try { reviewPlugin(user, (await context.params).reviewId, parsed.data); return NextResponse.json({ ok: true }); }
  catch (error) {
    if (error instanceof Error && error.message === "ADMIN_REQUIRED") return NextResponse.json({ message: "仅管理员可以审核插件" }, { status: 403 });
    return NextResponse.json({ message: "待审核记录不存在" }, { status: 404 });
  }
}

