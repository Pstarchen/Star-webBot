import { NextResponse } from "next/server";
import { z } from "zod";
import { getBotClient } from "@/lib/bot-service";
import { isQQApiError, validateQQApiPath } from "@/lib/qq-api";
import { getSession } from "@/lib/session";
import { assertTrustedRequest } from "@/lib/security";

const schema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().trim().min(1).max(500),
  body: z.unknown().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ botId: string }> }) {
  try { assertTrustedRequest(request); }
  catch { return NextResponse.json({ message: "请求来源不受信任" }, { status: 403 }); }
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "OpenAPI 请求参数不合法", issues: parsed.error.issues }, { status: 400 });

  let path: string;
  try {
    path = validateQQApiPath(parsed.data.path);
  } catch {
    return NextResponse.json({ message: "只能请求 QQ Bot API 的相对路径，且不能包含路径穿越" }, { status: 400 });
  }

  try {
    const client = getBotClient(user, (await context.params).botId);
    return NextResponse.json(await client.request(path, parsed.data.method, parsed.data.body));
  } catch (error) {
    if (isQQApiError(error)) {
      return NextResponse.json({ message: error.message, traceId: error.traceId, detail: error.responseBody }, { status: error.status >= 400 && error.status < 500 ? 400 : 502 });
    }
    if (error instanceof Error && error.message === "BOT_NOT_FOUND") return NextResponse.json({ message: "机器人不存在" }, { status: 404 });
    return NextResponse.json({ message: "OpenAPI 请求失败" }, { status: 500 });
  }
}
