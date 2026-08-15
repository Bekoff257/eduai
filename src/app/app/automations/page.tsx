import { redirect } from "next/navigation";
import { getDashboardAuth } from "@/lib/dashboard/auth";
import { listAutomations } from "@/lib/services/automations";
import { AutomationsClient } from "@/app/app/automations/automations-client";

export default async function AutomationsPage() {
  const auth = await getDashboardAuth();
  if (auth.status !== "authenticated" || auth.organization.status !== "single") {
    redirect("/login");
  }

  const { organization } = auth.organization;
  const automations = await listAutomations(organization.id);

  return <AutomationsClient initialAutomations={automations} canManage={organization.role === "owner" || organization.role === "admin"} />;
}
