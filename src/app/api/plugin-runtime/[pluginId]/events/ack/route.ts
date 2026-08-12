import { NextResponse } from "next/server";
import { z } from "zod";
import { acknowledgeSdkEvents, authenticatePluginRequest } from "@/lib/plugin-service";
import { RateLimitError, consumeRateLimit } from "@/lib/security";

const schema = z.object({ leaseToken: z.string().min(16).max(128), deliveryIds: z.array(z.string().uuid()).min(1).max(50) });

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
    if (!authentication.permissions.includes("event:receive")) return NextResponse.json({ message: "SDK 应用未获得事件确认权限" }, { status: 403 });
    consumeRateLimit("sdk-events-ack:" + pluginId, 240, 60_000);
    const parsed = schema.safeParse(JSON.parse(rawBody || "null"));
    if (!parsed.success) return NextResponse.json({ message: "事件确认参数不合法" }, { status: 400 });
    const acknowledged = acknowledgeSdkEvents(pluginId, parsed.data.leaseToken, parsed.data.deliveryIds);
    if (acknowledged !== parsed.data.deliveryIds.length) return NextResponse.json({ message: "事件租约已过期或不属于当前 SDK 应用", acknowledged }, { status: 409 });
    return NextResponse.json({ acknowledged });
  } catch (error) {
    if (error instanceof RateLimitError) return NextResponse.json({ message: "事件确认过于频繁" }, { status: 429 });
    if (error instanceof SyntaxError) return NextResponse.json({ message: "请求体不是有效 JSON" }, { status: 400 });
    if (error instanceof Error && error.message === "PLUGIN_REQUEST_REPLAYED") return NextResponse.json({ message: "SDK 请求已被使用" }, { status: 409 });
    return NextResponse.json({ message: "SDK 身份验证失败" }, { status: 401 });
  }
}
