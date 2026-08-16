import { redirect } from "next/navigation";
import { InstallSetupForm } from "@/components/install-setup-form";
import { databaseConfigurationForSetup } from "@/lib/database-config";
import { getPublicSiteSettings, installationStatus } from "@/lib/system-settings-service";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  if (!installationStatus().needed) redirect("/login");
  return <InstallSetupForm site={getPublicSiteSettings()} database={databaseConfigurationForSetup()} />;
}
