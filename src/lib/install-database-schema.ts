import { z } from "zod";
import type { DatabaseConfigurationInput } from "@/lib/database-config";

export const installationDatabaseSchema = z.object({
  provider: z.enum(["sqlite", "mysql"]),
  sqlitePath: z.string().trim().min(1).max(1_024),
  mysqlHost: z.string().trim().max(255),
  mysqlPort: z.number().int().min(1).max(65_535),
  mysqlUser: z.string().trim().max(255),
  mysqlPassword: z.string().max(1_024),
  mysqlDatabase: z.string().trim().max(255),
  mysqlSsl: z.boolean(),
});

export type InstallationDatabaseValues = z.infer<typeof installationDatabaseSchema>;

export function installationDatabaseErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.match(/\b(?:ER|MYSQL|DATABASE)_[A-Z0-9_]+\b/)?.[0] || "UNKNOWN";
}

export function toDatabaseConfigurationInput(input: InstallationDatabaseValues): DatabaseConfigurationInput {
  if (input.provider === "sqlite") return { provider: "sqlite", path: input.sqlitePath };
  return {
    provider: "mysql",
    host: input.mysqlHost,
    port: input.mysqlPort,
    user: input.mysqlUser,
    password: input.mysqlPassword,
    database: input.mysqlDatabase,
    ssl: input.mysqlSsl,
  };
}

export function installationDatabaseErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "SQLITE_PATH_INVALID") return "SQLite 数据库文件路径不合法";
  if (code === "MYSQL_CONFIGURATION_INVALID" || code === "MYSQL_ENVIRONMENT_INVALID") return "请完整填写 MySQL 主机、端口、用户名和数据库名";
  if (code.includes("MYSQL_CONNECTION_TIMEOUT") || code.includes("ETIMEDOUT") || code.includes("ECONNREFUSED")) return "无法连接 MySQL，请检查主机、端口和网络访问";
  if (code.includes("ER_ACCESS_DENIED_ERROR")) return "MySQL 用户名或密码不正确";
  if (code.includes("ER_BAD_DB_ERROR")) return "指定的 MySQL 数据库不存在";
  if (code.includes("ER_DBACCESS_DENIED_ERROR")) return "MySQL 用户没有该数据库的访问权限";
  if (code.includes("MYSQL_EXISTING_SCHEMA_INCOMPATIBLE") || code.includes("ER_FK_INCOMPATIBLE_COLUMNS") || code.includes("ER_CANNOT_ADD_FOREIGN")) return "目标数据库中已有不兼容表结构，请使用空数据库或联系管理员迁移现有数据";
  if (code.includes("ER_TABLEACCESS_DENIED_ERROR") || code.includes("ER_COLUMNACCESS_DENIED_ERROR") || code.includes("ER_SPECIFIC_ACCESS_DENIED_ERROR")) return "MySQL 用户缺少建表或修改表结构的权限";
  if (code.includes("ER_PARSE_ERROR") || code.includes("ER_NOT_SUPPORTED_YET") || code.includes("ER_TOO_LONG_KEY")) return "当前 MySQL 版本与表结构不兼容，请联系管理员升级部署程序";
  if (code.includes("DATABASE_CONFIG_INVALID") || code.includes("DATABASE_PROVIDER_INVALID")) return "数据库启动配置无效，请检查环境变量或重新填写安装信息";
  return "数据库连接或初始化失败，请检查配置后重试";
}
