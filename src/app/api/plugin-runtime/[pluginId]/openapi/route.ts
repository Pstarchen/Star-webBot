import { NextResponse } from "next/server";
import { z } from "zod";
import { getBotClientInternal } from "@/lib/bot-service";
import { authenticatePluginRequest } from "@/lib/plugin-service";
import { QQApiError, validateQQApiPath } from "@/lib/qq-api";
import { RateLimitError, consumeRateLimit } from "@/lib/security";

const schema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().trim().min(1).max(500),
  body: z.unknown().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ pluginId: string }> }) {
  const pluginId = (await context.params).pluginId;
  const rawBody = await request.text();
  const timestamp = request.headers.get("x-starbot-timestamp") || "";
  const nonce = request.headers.get("x-starbot-nonce") || "";
  const signature = request.headers.get("x-starbot-signature") || "";

  let authentication: ReturnType<typeof authenticatePluginRequest>;
  try {
    authentication = authenticatePluginRequest(pluginId, timestamp, nonce, rawBody, signature);
    consumeRateLimit("plugin-runtime:" + pluginId, 120, 60_000);
  } catch (error) {
    if (error instanceof RateLimitError) return NextResponse.json({ message: "SDK 请求过于频繁" }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    if (error instanceof Error && error.message === "PLUGIN_REQUEST_REPLAYED") return NextResponse.json({ message: "SDK 请求已被使用" }, { status: 409 });
    return NextResponse.json({ message: "SDK 身份验证失败" }, { status: 401 });
  }

  if (!authentication.permissions.includes("qq:api")) return NextResponse.json({ message: "SDK 应用未获得 qq:api 权限" }, { status: 403 });
  let requestBody: unknown;
  try { requestBody = JSON.parse(rawBody || "null"); }
  catch { return NextResponse.json({ message: "请求体不是有效 JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(requestBody);
  if (!parsed.success) return NextResponse.json({ message: "OpenAPI 请求参数不合法" }, { status: 400 });

  let path: string;
  try { path = validateQQApiPath(parsed.data.path); }
  catch { return NextResponse.json({ message: "QQ API 路径不合法" }, { status: 400 }); }

  try {
    return NextResponse.json(await getBotClientInternal(authentication.botId).request(path, parsed.data.method, parsed.data.body));
  } catch (error) {
    if (error instanceof QQApiError) return NextResponse.json({ message: error.message, traceId: error.traceId, detail: error.responseBody }, { status: 400 });
    return NextResponse.json({ message: "QQ OpenAPI 请求失败" }, { status: 502 });
  }
}
