import { redirect } from "next/navigation";
import { OfficialHome } from "@/components/official-home";
import { getSession } from "@/lib/session";
import { getPublicSiteSettings, installationStatus } from "@/lib/system-settings-service";

export default async function Home() {
  if (installationStatus().needed) redirect("/setup");
  const user = await getSession();
  return <OfficialHome site={getPublicSiteSettings()} signedIn={Boolean(user)} />;
}
