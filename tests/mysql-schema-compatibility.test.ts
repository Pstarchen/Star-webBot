import { describe, expect, it } from "vitest";
import { installationDatabaseErrorCode, installationDatabaseErrorMessage } from "@/lib/install-database-schema";
import { MYSQL_SCHEMA, mysqlIndexedIdentifierLengthForVersion, mysqlSchemaForVersion } from "@/lib/mysql-schema";

describe("MySQL schema compatibility", () => {
  it("uses a version-independent nullable marker for the pending review constraint", () => {
    expect(MYSQL_SCHEMA).toContain("pending_project_id VARCHAR(191)");
    expect(MYSQL_SCHEMA).toContain("UNIQUE KEY plugin_market_reviews_pending_idx (pending_project_id)");
    expect(MYSQL_SCHEMA).not.toMatch(/UNIQUE KEY\s+\w+\s*\(\(/);
    expect(MYSQL_SCHEMA).not.toMatch(/\bGENERATED\s+ALWAYS\b/);
  });

  it("uses compact indexed columns within the MySQL 5.6 utf8mb4 key limit", () => {
    const schema = mysqlSchemaForVersion("5.6.51");
    expect(mysqlIndexedIdentifierLengthForVersion("5.6.51")).toBe(64);
    expect(schema).toContain("id VARCHAR(64) PRIMARY KEY");
    expect(schema).toContain("email VARCHAR(160) NOT NULL UNIQUE");
    expect(schema).toContain("token_hash VARCHAR(64) NOT NULL UNIQUE");
    expect(schema).toContain("PRIMARY KEY (installation_id, `key`)");
    expect(schema).toContain("KEY email_verification_codes_lookup_idx (email(112), purpose, created_at)");
    expect(schema).toContain("PRIMARY KEY (plugin_id, nonce_hash)");
    expect(schema).toContain("event_key VARCHAR(127) NOT NULL");
    expect(schema).not.toContain("VARCHAR(191)");
  });

  it("preserves the existing schema for MySQL 5.7 and newer", () => {
    expect(mysqlSchemaForVersion("5.7.44")).toBe(MYSQL_SCHEMA);
    expect(mysqlSchemaForVersion("8.4.6")).toBe(MYSQL_SCHEMA);
    expect(mysqlIndexedIdentifierLengthForVersion("10.1.48-MariaDB")).toBe(64);
    expect(mysqlIndexedIdentifierLengthForVersion("10.2.44-MariaDB")).toBe(191);
  });

  it("reports unsupported MySQL syntax without exposing connection details", () => {
    expect(installationDatabaseErrorMessage(new Error("ER_PARSE_ERROR: syntax error"))).toBe("当前 MySQL 版本与表结构不兼容，请联系管理员升级部署程序");
    expect(installationDatabaseErrorMessage(new Error("ER_TOO_LONG_KEY: key is too long"))).toBe("当前 MySQL 版本与表结构不兼容，请联系管理员升级部署程序");
    expect(installationDatabaseErrorCode(new Error("ER_PARSE_ERROR: syntax error near password=secret"))).toBe("ER_PARSE_ERROR");
  });
});
