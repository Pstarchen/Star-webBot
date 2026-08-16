import { describe, expect, it } from "vitest";
import { installationDatabaseErrorMessage } from "@/lib/install-database-schema";
import { MYSQL_SCHEMA } from "@/lib/mysql-schema";

describe("MySQL schema compatibility", () => {
  it("uses a MySQL 5.7-compatible generated column for the pending review constraint", () => {
    expect(MYSQL_SCHEMA).toMatch(/pending_project_id VARCHAR\(191\)\s+GENERATED ALWAYS AS \(CASE WHEN status = 'pending' THEN project_id ELSE NULL END\) STORED/);
    expect(MYSQL_SCHEMA).toContain("UNIQUE KEY plugin_market_reviews_pending_idx (pending_project_id)");
    expect(MYSQL_SCHEMA).not.toMatch(/UNIQUE KEY\s+\w+\s*\(\(/);
  });

  it("reports unsupported MySQL syntax without exposing connection details", () => {
    expect(installationDatabaseErrorMessage(new Error("ER_PARSE_ERROR: syntax error"))).toBe("当前 MySQL 版本与表结构不兼容，请联系管理员升级部署程序");
  });
});
