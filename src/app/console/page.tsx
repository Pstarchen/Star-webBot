import { redirect } from "next/navigation";
import { PlatformShell } from "@/components/platform-shell";
import { listBots, listEvents } from "@/lib/bot-service";
import { listPluginCenter } from "@/lib/hosted-plugin-service";
import { getSession } from "@/lib/session";
import { getPublicSiteSettings, installationStatus } from "@/lib/system-settings-service";
import { listTeamMembers } from "@/lib/user-service";

export const dynamic = "force-dynamic";

export default async function ConsolePage() {
  if (installationStatus().needed) redirect("/setup");
  const user = await getSession();
  if (!user) redirect("/login");
  return <PlatformShell user={user} initialBots={listBots(user)} initialEvents={listEvents(user, 100)} initialPluginCenter={listPluginCenter(user)} initialMembers={listTeamMembers(user)} site={getPublicSiteSettings()} />;
}
