import { redirect } from "next/navigation";
import { getDashboardAuth } from "@/lib/dashboard/auth";
import { getBusinessSettings } from "@/lib/services/business-settings";
import { AISettingsClient } from "@/app/app/ai-settings/ai-settings-client";

export default async function AISettingsPage() {
  const auth = await getDashboardAuth();
  if (auth.status !== "authenticated" || auth.organization.status !== "single") {
    redirect("/login");
  }

  const { organization } = auth.organization;
  const settings = await getBusinessSettings(organization.id);
  const canManage = organization.role === "owner" || organization.role === "admin";

  return <AISettingsClient initialSettings={settings} canManage={canManage} />;
}
