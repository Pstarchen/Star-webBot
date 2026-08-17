import { NextResponse } from "next/server";
import { z } from "zod";
import { deletePluginRecord, listPluginRecords, setPluginRecord } from "@/lib/hosted-plugin-service";
import { getSession } from "@/lib/session";
import { assertTrustedRequest } from "@/lib/security";

const keySchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/);
const setSchema = z.object({ key: keySchema, value: z.json() });
const deleteSchema = z.object({ key: keySchema });

function recordError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "PLUGIN_CONFIG_PAGE_RECORDS_DENIED") return NextResponse.json({ message: "插件未声明配置记录权限", code }, { status: 403 });
  if (code.startsWith("PLUGIN_KV_")) return NextResponse.json({ message: "记录内容或容量不合法", code }, { status: 400 });
  return NextResponse.json({ message: "插件配置页面不存在或无权访问" }, { status: 404 });
}

export async function GET(_request: Request, context: { params: Promise<{ installationId: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  try { return NextResponse.json({ records: listPluginRecords(user, (await context.params).installationId) }); }
  catch (error) { return recordError(error); }
}

export async function PUT(request: Request, context: { params: Promise<{ installationId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const parsed = setSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "记录参数不合法", issues: parsed.error.issues }, { status: 400 });
  try {
    setPluginRecord(user, (await context.params).installationId, parsed.data.key, parsed.data.value);
    return NextResponse.json({ ok: true });
  } catch (error) { return recordError(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ installationId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "记录参数不合法", issues: parsed.error.issues }, { status: 400 });
  try {
    deletePluginRecord(user, (await context.params).installationId, parsed.data.key);
    return NextResponse.json({ ok: true });
  } catch (error) { return recordError(error); }
}
