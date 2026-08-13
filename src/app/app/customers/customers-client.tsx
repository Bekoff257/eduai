"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Customer } from "@/lib/services/customers";
import { Card } from "@/components/ui/card";
import { TextInput } from "@/components/ui/field";
import { SearchIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/states";
import { Pagination } from "@/components/ui/pagination";
import { CustomerDetailPanel } from "@/app/app/customers/customer-detail-panel";

export function CustomersClient({
  initialCustomers,
  totalCount,
  initialQuery,
  initialPage,
}: {
  initialCustomers: Customer[];
  totalCount: number;
  initialQuery: string;
  initialPage: number;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [, startTransition] = useTransition();

  function handleSearch(value: string) {
    setQuery(value);
    startTransition(() => {
      const params = new URLSearchParams();
      if (value.trim()) params.set("q", value.trim());
      router.push(`/app/customers${params.toString() ? `?${params}` : ""}`);
    });
  }

  function buildPageHref(page: number) {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (page > 1) params.set("page", String(page));
    return `/app/customers${params.toString() ? `?${params}` : ""}`;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Customers</h1>
        <p className="mt-1 text-sm text-muted">Everyone who has messaged your Telegram bot.</p>
      </div>

      <div className="relative max-w-sm">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <TextInput
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search by name, username, or phone…"
          className="pl-9"
        />
      </div>

      {initialCustomers.length === 0 ? (
        <EmptyState
          title={totalCount === 0 ? "No customers yet" : "No customers match your search"}
          description={
            totalCount === 0
              ? "Customers appear here automatically once they message your Telegram bot."
              : undefined
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Telegram</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Language</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {initialCustomers.map((customer) => (
                  <tr
                    key={customer.id}
                    onClick={() => setSelected(customer)}
                    className="cursor-pointer hover:bg-surface-hover"
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      {customer.fullName ?? "Unnamed"}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {customer.telegramUsername ? `@${customer.telegramUsername}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted">{customer.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-muted">{customer.language ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 pb-4">
            <Pagination page={initialPage} pageSize={20} totalCount={totalCount} buildHref={buildPageHref} />
          </div>
        </Card>
      )}

      {selected && <CustomerDetailPanel customer={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
