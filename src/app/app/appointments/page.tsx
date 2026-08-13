import { redirect } from "next/navigation";
import { getDashboardAuth } from "@/lib/dashboard/auth";
import { listAppointments } from "@/lib/services/appointments";
import { AppointmentsClient } from "@/app/app/appointments/appointments-client";

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ timeframe?: string; page?: string }>;
}) {
  const auth = await getDashboardAuth();
  if (auth.status !== "authenticated" || auth.organization.status !== "single") {
    redirect("/login");
  }

  const { timeframe: timeframeParam, page: pageParam } = await searchParams;
  const timeframe = timeframeParam === "past" ? "past" : "upcoming";
  const page = pageParam ? Number(pageParam) : 1;
  const nowIso = new Date().toISOString();

  const { organization } = auth.organization;
  const result = await listAppointments(organization.id, {
    from: timeframe === "upcoming" ? nowIso : undefined,
    to: timeframe === "past" ? nowIso : undefined,
    page,
    pageSize: 20,
  });

  return (
    <AppointmentsClient
      initialAppointments={result.appointments}
      totalCount={result.totalCount}
      timeframe={timeframe}
      page={page}
    />
  );
}
