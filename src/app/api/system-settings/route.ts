import { NextResponse } from "next/server";
import { z } from "zod";
import { assertTrustedRequest } from "@/lib/security";
import { getSession } from "@/lib/session";
import { getAdminSystemSettings, updatePaymentSettings, updateQQLoginSettings, updateSiteSettings } from "@/lib/system-settings-service";

const siteSchema = z.object({
  section: z.literal("site"),
  siteName: z.string().trim().min(2).max(40),
  siteTagline: z.string().trim().max(80),
  siteDescription: z.string().trim().min(10).max(300),
  icpCode: z.string().trim().max(80),
  icpUrl: z.url().or(z.literal("")),
  policeCode: z.string().trim().max(80),
  policeUrl: z.url().or(z.literal("")),
  copyrightText: z.string().trim().max(120),
});

const qqSchema = z.object({
  section: z.literal("qq"),
  enabled: z.boolean(),
  appId: z.string().trim().max(80),
  appSecret: z.string().max(300).optional(),
  clearSecret: z.boolean().optional(),
  redirectUri: z.url().or(z.literal("")),
});

const paymentSchema = z.object({
  section: z.literal("payment"),
  enabled: z.boolean(),
  provider: z.enum(["sandbox", "manual", "epay"]),
  epayGatewayUrl: z.url().or(z.literal("")),
  epayPid: z.string().trim().max(80),
  epayKey: z.string().max(300).optional(),
  clearKey: z.boolean().optional(),
  manualInstructions: z.string().trim().max(1000),
});

const schema = z.discriminatedUnion("section", [siteSchema, qqSchema, paymentSchema]);

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  try { return NextResponse.json({ settings: getAdminSystemSettings(user) }); }
  catch { return NextResponse.json({ message: "需要管理员权限" }, { status: 403 }); }
}

export async function PATCH(request: Request) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "系统设置参数不合法", issues: parsed.error.issues }, { status: 400 });
  try {
    const input = parsed.data;
    const settings = input.section === "site"
      ? updateSiteSettings(user, input)
      : input.section === "qq"
        ? updateQQLoginSettings(user, input)
        : updatePaymentSettings(user, input);
    return NextResponse.json({ settings });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "ADMIN_REQUIRED") return NextResponse.json({ message: "需要管理员权限" }, { status: 403 });
    if (code === "QQ_LOGIN_CONFIG_INCOMPLETE") return NextResponse.json({ message: "启用 QQ 登录前需完整填写 AppID 和 App Secret" }, { status: 400 });
    if (code === "PAYMENT_CONFIG_INCOMPLETE") return NextResponse.json({ message: "启用易支付前需完整填写网关地址、商户 ID 和商户密钥" }, { status: 400 });
    if (code === "PAYMENT_SANDBOX_PRODUCTION_DISABLED") return NextResponse.json({ message: "生产环境不能启用沙箱支付" }, { status: 400 });
    return NextResponse.json({ message: "系统设置保存失败" }, { status: 500 });
  }
}
