import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listTeamMembers } from "@/lib/user-service";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  return NextResponse.json({ users: listTeamMembers(user) });
}
