import { NextResponse } from "next/server";
import { z } from "zod";
import { removeMarketplacePlugin, updateMarketplacePlugin } from "@/lib/hosted-plugin-service";
import { assertTrustedRequest } from "@/lib/security";
import { getSession } from "@/lib/session";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().min(1).max(500).optional(),
  author: z.string().trim().min(1).max(80).optional(),
  category: z.string().trim().min(1).max(40).optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(8).optional(),
  featured: z.boolean().optional(),
  priceCents: z.number().int().min(0).max(100_000_000).optional(),
}).strict().refine((input) => Object.values(input).some((value) => value !== undefined), "至少提供一个更新字段");

const removeSchema = z.object({
  reason: z.string().trim().max(500).optional(),
}).strict();

function trustedMutation(request: Request) {
  try { assertTrustedRequest(request); return null; }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
}

async function adminSession() {
  const user = await getSession();
  if (!user) return { response: NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 }) };
  if (user.role !== "admin") return { response: NextResponse.json({ message: "仅管理员可以管理插件市场" }, { status: 403 }) };
  return { user };
}

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const untrusted = trustedMutation(request);
  if (untrusted) return untrusted;
  const session = await adminSession();
  if ("response" in session) return session.response;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "插件市场信息不合法", issues: parsed.error.issues }, { status: 400 });
  try {
    const marketplace = updateMarketplacePlugin(session.user, (await context.params).projectId, parsed.data);
    return NextResponse.json({ ok: true, marketplace });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code.startsWith("PLUGIN_MARKETPLACE_") && code !== "PLUGIN_MARKETPLACE_NOT_FOUND") {
      return NextResponse.json({ message: "插件市场信息不合法", code }, { status: 400 });
    }
    return NextResponse.json({ message: "插件市场条目不存在", code: "PLUGIN_MARKETPLACE_NOT_FOUND" }, { status: 404 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const untrusted = trustedMutation(request);
  if (untrusted) return untrusted;
  const session = await adminSession();
  if ("response" in session) return session.response;
  const parsed = removeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: "下架原因不合法", issues: parsed.error.issues }, { status: 400 });
  try {
    const result = removeMarketplacePlugin(session.user, (await context.params).projectId, parsed.data.reason);
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json({ message: "插件市场条目不存在", code: "PLUGIN_MARKETPLACE_NOT_FOUND" }, { status: 404 });
  }
}
