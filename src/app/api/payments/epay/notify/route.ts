import { verifyEpayNotification } from "@/lib/membership-service";

async function parameters(request: Request) {
  if (request.method === "GET") return Object.fromEntries(new URL(request.url).searchParams);
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return await request.json() as Record<string, string>;
  return Object.fromEntries(new URLSearchParams(await request.text()));
}

async function handle(request: Request) {
  try { verifyEpayNotification(await parameters(request)); return new Response("success", { status: 200 }); }
  catch { return new Response("fail", { status: 400 }); }
}

export const GET = handle;
export const POST = handle;
