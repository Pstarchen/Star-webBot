import { NextResponse } from "next/server";
import { testDatabaseConfiguration } from "@/lib/database";
import { installationDatabaseErrorMessage, installationDatabaseSchema, toDatabaseConfigurationInput } from "@/lib/install-database-schema";
import { RateLimitError, assertTrustedRequest, consumeRateLimit, rateLimitKey } from "@/lib/security";
import { installationStatus } from "@/lib/system-settings-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  if (!installationStatus().needed) return NextResponse.json({ message: "系统已完成初始化，不能再修改数据库" }, { status: 409 });
  try {
    consumeRateLimit(rateLimitKey(request, "install.database_test"), 8, 15 * 60 * 1000);
  } catch (error) {
    if (error instanceof RateLimitError) return NextResponse.json({ message: "测试次数过多，请稍后再试" }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    throw error;
  }

  const parsed = installationDatabaseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "数据库参数不合法" }, { status: 400 });
  try {
    const provider = testDatabaseConfiguration(toDatabaseConfigurationInput(parsed.data));
    return NextResponse.json({ provider, message: provider === "mysql" ? "MySQL 连接和表结构检查通过" : "SQLite 文件路径可用" });
  } catch (error) {
    return NextResponse.json({ message: installationDatabaseErrorMessage(error) }, { status: 400 });
  }
}
