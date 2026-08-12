import { NextResponse } from "next/server";
import { z } from "zod";
import { deletePlugin, rotatePluginSecret, setPluginEnabled } from "@/lib/plugin-service";
import { getSession } from "@/lib/session";
import { assertTrustedRequest } from "@/lib/security";

const schema = z.object({ enabled: z.boolean() });

export async function PATCH(request: Request, context: { params: Promise<{ pluginId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "SDK 应用状态不合法" }, { status: 400 });
  try { setPluginEnabled(user, (await context.params).pluginId, parsed.data.enabled); return NextResponse.json({ ok: true }); }
  catch { return NextResponse.json({ message: "SDK 应用不存在或无权操作" }, { status: 404 }); }
}

export async function POST(request: Request, context: { params: Promise<{ pluginId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  try { return NextResponse.json({ signingSecret: rotatePluginSecret(user, (await context.params).pluginId) }); }
  catch { return NextResponse.json({ message: "SDK 应用不存在或无权操作" }, { status: 404 }); }
}

export async function DELETE(request: Request, context: { params: Promise<{ pluginId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  try { deletePlugin(user, (await context.params).pluginId); return NextResponse.json({ ok: true }); }
  catch { return NextResponse.json({ message: "SDK 应用不存在或无权操作" }, { status: 404 }); }
}
