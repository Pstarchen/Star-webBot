import { describe, expect, it } from "vitest";
import { GET } from "../src/app/docs/plugin-development/download/route";

describe("plugin development documentation", () => {
  it("downloads the repository Markdown guide", async () => {
    const response = await GET();
    const markdown = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("content-disposition")).toContain("starbot-plugin-development.md");
    expect(markdown).toContain("# StarBot 托管插件开发");
    expect(markdown).toContain("## 8. SDK 能力");
    expect(markdown).toContain("`http:request`");
    expect(markdown).toContain("QQ 机器人 API v2");
  });
});
