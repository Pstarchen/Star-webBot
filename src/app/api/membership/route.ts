import { NextResponse } from "next/server";
import { membershipCenter } from "@/lib/membership-service";
import { getSession } from "@/lib/session";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  try {
    return NextResponse.json(membershipCenter(user));
  } catch (error) {
    console.error("Membership center load failed", error);
    return NextResponse.json({ message: "会员中心加载失败，请稍后重试", code: "MEMBERSHIP_CENTER_LOAD_FAILED" }, { status: 500 });
  }
}
