import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticatePluginRequest, claimSdkEvents } from "@/lib/plugin-service";
import { RateLimitError, consumeRateLimit } from "@/lib/security";

const schema = z.object({ limit: z.number().int().min(1).max(50).default(10), waitMs: z.number().int().min(0).max(25_000).default(25_000) });

export async function POST(request: Request, context: { params: Promise<{ pluginId: string }> }) {
  const pluginId = (await context.params).pluginId;
  const rawBody = await request.text();
  try {
    const authentication = authenticatePluginRequest(
      pluginId,
      request.headers.get("x-starbot-timestamp") || "",
      request.headers.get("x-starbot-nonce") || "",
      rawBody,
      request.headers.get("x-starbot-signature") || "",
    );
    if (!authentication.permissions.includes("event:receive")) return NextResponse.json({ message: "SDK 应用未获得事件读取权限" }, { status: 403 });
    consumeRateLimit("sdk-events-pull:" + pluginId, 180, 60_000);
    const parsed = schema.safeParse(JSON.parse(rawBody || "null"));
    if (!parsed.success) return NextResponse.json({ message: "事件拉取参数不合法" }, { status: 400 });
    const deadline = Date.now() + parsed.data.waitMs;
    let claimed = claimSdkEvents(pluginId, parsed.data.limit);
    while (!claimed.events.length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(500, deadline - Date.now())));
      claimed = claimSdkEvents(pluginId, parsed.data.limit);
    }
    return NextResponse.json(claimed, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RateLimitError) return NextResponse.json({ message: "事件拉取过于频繁" }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    if (error instanceof SyntaxError) return NextResponse.json({ message: "请求体不是有效 JSON" }, { status: 400 });
    if (error instanceof Error && error.message === "PLUGIN_REQUEST_REPLAYED") return NextResponse.json({ message: "SDK 请求已被使用" }, { status: 409 });
    return NextResponse.json({ message: "SDK 身份验证失败" }, { status: 401 });
  }
}
