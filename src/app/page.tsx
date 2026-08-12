import { redirect } from "next/navigation";
import { PlatformShell } from "@/components/platform-shell";
import { listBots, listEvents } from "@/lib/bot-service";
import { listPlugins } from "@/lib/plugin-service";
import { getSession } from "@/lib/session";
import { listTeamMembers } from "@/lib/user-service";

export default async function Home() {
  const user = await getSession();
  if (!user) redirect("/login");
  return (
    <PlatformShell
      user={user}
      initialBots={listBots(user)}
      initialEvents={listEvents(user, 100)}
      initialPlugins={listPlugins(user)}
      initialMembers={listTeamMembers(user)}
    />
  );
}
