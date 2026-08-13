"use client";

import { useState } from "react";
import Link from "next/link";
import type { LeadListItem, LeadStatus } from "@/lib/services/leads";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { Pagination } from "@/components/ui/pagination";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";

const STATUS_TABS: { label: string; value: LeadStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "New", value: "new" },
  { label: "Contacted", value: "contacted" },
  { label: "Qualified", value: "qualified" },
  { label: "Booked", value: "appointment_booked" },
  { label: "Converted", value: "converted" },
  { label: "Lost", value: "lost" },
];

const STATUS_TONE: Record<LeadStatus, BadgeTone> = {
  new: "accent",
  contacted: "neutral",
  qualified: "warning",
  appointment_booked: "success",
  converted: "success",
  lost: "danger",
};

const STATUS_OPTIONS: LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "appointment_booked",
  "converted",
  "lost",
];

export function LeadsClient({
  initialLeads,
  totalCount,
  status,
  page,
}: {
  initialLeads: LeadListItem[];
  totalCount: number;
  status: LeadStatus | undefined;
  page: number;
}) {
  const { showToast } = useToast();
  const [leads, setLeads] = useState(initialLeads);

  function buildHref(nextStatus: LeadStatus | "all", nextPage = 1) {
    const params = new URLSearchParams();
    if (nextStatus !== "all") params.set("status", nextStatus);
    if (nextPage > 1) params.set("page", String(nextPage));
    return `/app/leads${params.toString() ? `?${params}` : ""}`;
  }

  async function handleStatusChange(leadId: string, newStatus: LeadStatus) {
    const prev = leads;
    setLeads((cur) => cur.map((l) => (l.id === leadId ? { ...l, status: newStatus } : l)));
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error();
      showToast("Lead status updated", "success");
    } catch {
      setLeads(prev);
      showToast("Failed to update lead status", "danger");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Leads</h1>
        <p className="mt-1 text-sm text-muted">Prospects your AI receptionist has captured.</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STATUS_TABS.map((tab) => {
          const isActive = (status ?? "all") === tab.value;
          return (
            <Link
              key={tab.value}
              href={buildHref(tab.value)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? "bg-accent/10 text-accent"
                  : "text-foreground/80 hover:bg-surface-hover"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {leads.length === 0 ? (
        <EmptyState
          title="No leads here"
          description="As your AI receptionist qualifies customer interest, leads will show up here."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Course interest</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Next follow-up</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leads.map((lead) => (
                  <tr key={lead.id}>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {lead.customerName ?? "Unknown"}
                    </td>
                    <td className="px-4 py-3 text-muted">{lead.courseName ?? "—"}</td>
                    <td className="px-4 py-3 text-muted capitalize">{lead.source}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Badge tone={STATUS_TONE[lead.status]}>{lead.status.replace(/_/g, " ")}</Badge>
                        <Select
                          value={lead.status}
                          onChange={(e) => handleStatusChange(lead.id, e.target.value as LeadStatus)}
                          className="w-auto py-1 text-xs"
                          aria-label={`Change status for ${lead.customerName ?? "lead"}`}
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>
                              {s.replace(/_/g, " ")}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {lead.nextFollowUpAt ? formatDate(lead.nextFollowUpAt) : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted">{formatDate(lead.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 pb-4">
            <Pagination
              page={page}
              pageSize={20}
              totalCount={totalCount}
              buildHref={(p) => buildHref(status ?? "all", p)}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
