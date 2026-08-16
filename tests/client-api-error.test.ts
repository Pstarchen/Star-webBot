import { describe, expect, it } from "vitest";
import { formatApiError } from "@/lib/api-error";

describe("client API error formatting", () => {
  it("keeps plugin validation codes and details", () => {
    expect(formatApiError({
      message: "插件包校验失败",
      code: "PLUGIN_MANIFEST_INVALID:permissions.2: Invalid option",
      detail: "permissions.2: Invalid option",
    })).toBe("插件包校验失败（PLUGIN_MANIFEST_INVALID）：permissions.2: Invalid option");
  });

  it("uses details embedded in the error code", () => {
    expect(formatApiError({
      message: "插件包校验失败",
      code: "PLUGIN_CODE_ERROR:SyntaxError: unexpected token",
    })).toBe("插件包校验失败（PLUGIN_CODE_ERROR）：SyntaxError: unexpected token");
  });

  it("falls back safely for malformed responses", () => {
    expect(formatApiError(null)).toBe("请求失败");
    expect(formatApiError({ code: "PLUGIN_PACKAGE_INVALID" })).toBe("PLUGIN_PACKAGE_INVALID");
    expect(formatApiError({ message: "导入失败", code: "not-a-stable-code" })).toBe("导入失败");
  });
});
