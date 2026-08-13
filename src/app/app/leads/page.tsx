import { redirect } from "next/navigation";
import { getDashboardAuth } from "@/lib/dashboard/auth";
import { listLeads, type LeadStatus } from "@/lib/services/leads";
import { LeadsClient } from "@/app/app/leads/leads-client";

const VALID_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "appointment_booked",
  "converted",
  "lost",
];

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const auth = await getDashboardAuth();
  if (auth.status !== "authenticated" || auth.organization.status !== "single") {
    redirect("/login");
  }

  const { status: statusParam, page: pageParam } = await searchParams;
  const status = VALID_STATUSES.includes(statusParam as LeadStatus)
    ? (statusParam as LeadStatus)
    : undefined;
  const page = pageParam ? Number(pageParam) : 1;

  const { organization } = auth.organization;
  const result = await listLeads(organization.id, { status, page, pageSize: 20 });

  return (
    <LeadsClient
      initialLeads={result.leads}
      totalCount={result.totalCount}
      status={status}
      page={page}
    />
  );
}
