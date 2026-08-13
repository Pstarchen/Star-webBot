import { NextResponse } from "next/server";
import { z } from "zod";
import { requestPluginReview } from "@/lib/hosted-plugin-service";
import { getSession } from "@/lib/session";
import { assertTrustedRequest } from "@/lib/security";

const schema = z.object({ versionId: z.string().uuid().optional() });

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: "审核申请参数不合法" }, { status: 400 });
  try { return NextResponse.json(requestPluginReview(user, (await context.params).projectId, parsed.data.versionId), { status: 201 }); }
  catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "PLUGIN_REVIEW_ALREADY_PENDING") return NextResponse.json({ message: "该版本已经在审核中" }, { status: 409 });
    return NextResponse.json({ message: "插件项目或版本不存在" }, { status: 404 });
  }
}

