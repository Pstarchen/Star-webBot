import { describe, expect, it } from "vitest";
import { installationDatabaseErrorCode, installationDatabaseErrorMessage } from "@/lib/install-database-schema";
import { MYSQL_SCHEMA, mysqlSchemaForIndexedIdentifierLength } from "@/lib/mysql-schema";

describe("MySQL schema compatibility", () => {
  it("uses a version-independent nullable marker for the pending review constraint", () => {
    expect(MYSQL_SCHEMA).toContain("pending_project_id VARCHAR(191)");
    expect(MYSQL_SCHEMA).toContain("UNIQUE KEY plugin_market_reviews_pending_idx (pending_project_id)");
    expect(MYSQL_SCHEMA).not.toMatch(/UNIQUE KEY\s+\w+\s*\(\(/);
    expect(MYSQL_SCHEMA).not.toMatch(/\bGENERATED\s+ALWAYS\b/);
  });

  it("uses compact indexed columns for every fresh MySQL-compatible database", () => {
    const schema = mysqlSchemaForIndexedIdentifierLength(64);
    expect(schema).toContain("id VARCHAR(64) PRIMARY KEY");
    expect(schema).toContain("email VARCHAR(160) NOT NULL UNIQUE");
    expect(schema).toContain("token_hash VARCHAR(64) NOT NULL UNIQUE");
    expect(schema).toContain("PRIMARY KEY (installation_id, `key`)");
    expect(schema).toContain("KEY email_verification_codes_lookup_idx (email(112), purpose, created_at)");
    expect(schema).toContain("PRIMARY KEY (plugin_id, nonce_hash)");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS site_asset_chunks");
    expect(schema).toContain("time_zone VARCHAR(100) NOT NULL DEFAULT ''");
    expect(schema).toContain("PRIMARY KEY (kind, chunk_index)");
    expect(schema).toContain("event_key VARCHAR(127) NOT NULL");
    expect(schema).not.toContain("VARCHAR(191)");
  });

  it("preserves an existing 191-character schema during upgrades", () => {
    expect(mysqlSchemaForIndexedIdentifierLength(191)).toBe(MYSQL_SCHEMA);
  });

  it("reports unsupported MySQL syntax without exposing connection details", () => {
    expect(installationDatabaseErrorMessage(new Error("ER_PARSE_ERROR: syntax error"))).toBe("当前 MySQL 版本与表结构不兼容，请联系管理员升级部署程序");
    expect(installationDatabaseErrorMessage(new Error("ER_TOO_LONG_KEY: key is too long"))).toBe("当前 MySQL 版本与表结构不兼容，请联系管理员升级部署程序");
    expect(installationDatabaseErrorMessage(new Error("MYSQL_EXISTING_SCHEMA_INCOMPATIBLE"))).toBe("目标数据库中已有不兼容表结构，请使用空数据库或联系管理员迁移现有数据");
    expect(installationDatabaseErrorCode(new Error("ER_PARSE_ERROR: syntax error near password=secret"))).toBe("ER_PARSE_ERROR");
    expect(installationDatabaseErrorCode(new Error("CREDENTIAL_ENCRYPTION_KEY_INVALID"))).toBe("CREDENTIAL_ENCRYPTION_KEY_INVALID");
  });

  it("reports invalid server encryption keys separately from database errors", () => {
    expect(installationDatabaseErrorMessage(new Error("CREDENTIAL_ENCRYPTION_KEY_INVALID"))).toBe("服务器凭据加密密钥配置无效，请联系管理员");
  });
});
