import { redirect } from "next/navigation";
import { getDashboardAuth } from "@/lib/dashboard/auth";
import { getBusinessSettings } from "@/lib/services/business-settings";
import { listOrganizationMembers } from "@/lib/dashboard/organizations";
import { OrgSettingsClient } from "@/app/app/settings/org-settings-client";

export default async function SettingsPage() {
  const auth = await getDashboardAuth();
  if (auth.status !== "authenticated" || auth.organization.status !== "single") {
    redirect("/login");
  }

  const { organization } = auth.organization;
  const [settings, members] = await Promise.all([
    getBusinessSettings(organization.id),
    listOrganizationMembers(organization.id),
  ]);
  const canManage = organization.role === "owner" || organization.role === "admin";

  return (
    <OrgSettingsClient
      organization={organization}
      initialSettings={settings}
      members={members}
      canManage={canManage}
    />
  );
}
