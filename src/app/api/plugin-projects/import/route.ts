import { NextResponse } from "next/server";
import { importPluginPackage } from "@/lib/hosted-plugin-service";
import { getSession } from "@/lib/session";
import { assertTrustedRequest, consumeRateLimit, rateLimitKey, RateLimitError } from "@/lib/security";

export const runtime = "nodejs";

const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;

async function readPackage(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_PACKAGE_BYTES) throw new Error("PLUGIN_PACKAGE_TOO_LARGE");
  if (!request.body) throw new Error("PLUGIN_PACKAGE_EMPTY");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PACKAGE_BYTES) throw new Error("PLUGIN_PACKAGE_TOO_LARGE");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

function importError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (error instanceof RateLimitError) return NextResponse.json({ message: "插件导入过于频繁，请稍后重试" }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
  if (code.includes("UNIQUE")) return NextResponse.json({ message: "该插件版本已经导入" }, { status: 409 });
  if (code === "PLUGIN_PACKAGE_TOO_LARGE") return NextResponse.json({ message: "插件包不能超过 2MB" }, { status: 413 });
  if (code === "PLUGIN_PROJECT_SUSPENDED") return NextResponse.json({ message: "该插件项目已被管理员停用" }, { status: 403 });
  if (code.startsWith("PLUGIN_")) return NextResponse.json({ message: "插件包校验失败", code, detail: code.split(":").slice(1).join(":") || undefined }, { status: 400 });
  console.error("Plugin package import failed", {
    name: error instanceof Error ? error.name : typeof error,
    message: code || "UNKNOWN_ERROR",
  });
  return NextResponse.json({ message: "插件包导入失败", code: "PLUGIN_IMPORT_FAILED" }, { status: 500 });
}

export async function POST(request: Request) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/zip")) {
    return NextResponse.json({ message: "请上传 ZIP 格式的插件包" }, { status: 415 });
  }
  try {
    consumeRateLimit(rateLimitKey(request, "plugin-import", user.id), 20, 60_000);
    return NextResponse.json(await importPluginPackage(user, await readPackage(request)), { status: 201 });
  } catch (error) {
    return importError(error);
  }
}
