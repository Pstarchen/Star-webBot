import { NextResponse } from "next/server";
import { getPublicSiteSettings } from "@/lib/system-settings-service";

export async function GET() {
  return NextResponse.json({ settings: getPublicSiteSettings() });
}
