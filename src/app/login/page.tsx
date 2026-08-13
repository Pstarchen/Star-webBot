import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getSession } from "@/lib/session";
import { qqLoginEnabled } from "@/lib/qq-login";
import { getPublicSiteSettings } from "@/lib/system-settings-service";

const qqLoginErrors: Record<string, string> = {
  qq_callback_invalid: "QQ 登录回调参数已失效，请重新发起登录",
  qq_login_failed: "QQ 登录未完成，请稍后重试",
  qq_not_configured: "管理员尚未配置 QQ 互联应用",
  qq_start_failed: "暂时无法发起 QQ 登录，请稍后重试",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const user = await getSession();
  if (user) redirect("/");
  const errorCode = (await searchParams).error;
  const initialError = typeof errorCode === "string" ? qqLoginErrors[errorCode] || "" : "";
  return <LoginForm qqLoginEnabled={qqLoginEnabled()} site={getPublicSiteSettings()} initialError={initialError} />;
}
