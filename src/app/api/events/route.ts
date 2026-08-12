import { NextResponse } from "next/server";
import { listEvents } from "@/lib/bot-service";
import { getSession } from "@/lib/session";

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const limit = Math.min(500, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 100));
  return NextResponse.json({ events: listEvents(user, limit) });
}
