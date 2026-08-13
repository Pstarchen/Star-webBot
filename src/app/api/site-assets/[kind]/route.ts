import { NextResponse } from "next/server";
import { getSiteAsset } from "@/lib/system-settings-service";

export async function GET(_request: Request, context: { params: Promise<{ kind: string }> }) {
  const kind = (await context.params).kind;
  if (kind !== "logo" && kind !== "favicon") return new NextResponse(null, { status: 404 });
  const asset = getSiteAsset(kind);
  if (!asset.mime || !asset.data) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(asset.data), { headers: { "Content-Type": asset.mime, "Cache-Control": "public, max-age=300, must-revalidate" } });
}
