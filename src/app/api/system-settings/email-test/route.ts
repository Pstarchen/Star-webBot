import { NextResponse } from "next/server";
import { z } from "zod";
import { sendEmailConfigurationTest } from "@/lib/email-code-service";
import { assertTrustedRequest, consumeRateLimit, rateLimitKey, RateLimitError } from "@/lib/security";
import { getSession } from "@/lib/session";

const schema = z.object({
  email: z.email().max(160),
}).strict();

export async function POST(request: Request) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }

  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ message: "需要管理员权限" }, { status: 403 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "请填写有效的测试收件邮箱" }, { status: 400 });

  try {
    consumeRateLimit(rateLimitKey(request, "system.email_test", user.id), 5, 15 * 60 * 1000);
    return NextResponse.json(await sendEmailConfigurationTest(user, parsed.data.email));
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json({ message: "测试邮件发送过于频繁，请稍后重试" }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    }
    const code = error instanceof Error ? error.message.split(":", 1)[0] : "";
    if (code === "EMAIL_SMTP_NOT_CONFIGURED") return NextResponse.json({ message: "请先保存完整的 SMTP 配置" }, { status: 409 });
    if (code === "EMAIL_SMTP_TIMEOUT") return NextResponse.json({ message: "SMTP 服务器响应超时，请检查地址、端口和网络" }, { status: 504 });
    if (code === "EMAIL_SMTP_REJECTED") return NextResponse.json({ message: "SMTP 服务器拒绝了测试邮件，请检查账号、授权码和加密方式" }, { status: 502 });
    return NextResponse.json({ message: "测试邮件发送失败，请检查 SMTP 配置和服务器网络" }, { status: 502 });
  }
}
