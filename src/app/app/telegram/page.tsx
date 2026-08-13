import { redirect } from "next/navigation";
import { getDashboardAuth } from "@/lib/dashboard/auth";
import { getTelegramIntegrationSummary } from "@/lib/services/telegram-integrations";
import { TelegramClient } from "@/app/app/telegram/telegram-client";

export default async function TelegramPage() {
  const auth = await getDashboardAuth();
  if (auth.status !== "authenticated" || auth.organization.status !== "single") {
    redirect("/login");
  }

  const { organization } = auth.organization;
  const integration = await getTelegramIntegrationSummary(organization.id);
  const canManage = organization.role === "owner" || organization.role === "admin";

  return <TelegramClient initialIntegration={integration} canManage={canManage} />;
}
