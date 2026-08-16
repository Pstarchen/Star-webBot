import fs from "node:fs";
import { describe, expect, it } from "vitest";

const runtimeStateRoutes = [
  "../src/app/layout.tsx",
  "../src/app/page.tsx",
  "../src/app/setup/page.tsx",
  "../src/app/login/page.tsx",
  "../src/app/console/page.tsx",
];

describe("runtime route rendering", () => {
  it.each(runtimeStateRoutes)("keeps %s out of the prerender cache", (relativePath) => {
    const source = fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
    expect(source).toContain('export const dynamic = "force-dynamic";');
  });
});
