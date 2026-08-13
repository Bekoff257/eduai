import { redirect } from "next/navigation";
import { getDashboardAuth } from "@/lib/dashboard/auth";
import { listCustomers } from "@/lib/services/customers";
import { CustomersClient } from "@/app/app/customers/customers-client";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const auth = await getDashboardAuth();
  if (auth.status !== "authenticated" || auth.organization.status !== "single") {
    redirect("/login");
  }

  const { q, page } = await searchParams;
  const { organization } = auth.organization;
  const result = await listCustomers(organization.id, {
    query: q,
    page: page ? Number(page) : 1,
    pageSize: 20,
  });

  return (
    <CustomersClient
      initialCustomers={result.customers}
      totalCount={result.totalCount}
      initialQuery={q ?? ""}
      initialPage={page ? Number(page) : 1}
    />
  );
}
