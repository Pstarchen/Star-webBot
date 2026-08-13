import { NextResponse } from "next/server";
import { installationStatus } from "@/lib/system-settings-service";

export async function GET() {
  return NextResponse.json(installationStatus());
}
