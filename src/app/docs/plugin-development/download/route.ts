import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-static";

export async function GET() {
  const markdown = await readFile(path.join(process.cwd(), "docs", "plugin-development.md"), "utf8");

  return new Response(markdown, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      "Content-Disposition": 'attachment; filename="starbot-plugin-development.md"',
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}
