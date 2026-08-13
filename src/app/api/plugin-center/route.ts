import { NextResponse } from "next/server";
import { listPluginCenter } from "@/lib/hosted-plugin-service";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  return NextResponse.json(listPluginCenter(user));
}

