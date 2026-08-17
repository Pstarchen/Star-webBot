import { readPluginAsset } from "@/lib/hosted-plugin-service";

export async function GET(_request: Request, context: { params: Promise<{ installationId: string; assetId: string }> }) {
  try {
    const { installationId, assetId } = await context.params;
    const asset = readPluginAsset(installationId, assetId);
    return new Response(new Uint8Array(asset.bytes), {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": String(asset.size),
        "Content-Type": asset.mimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("媒体文件不存在", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
