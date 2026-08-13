"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Customer } from "@/lib/services/customers";
import type { Conversation } from "@/lib/services/conversations";
import type { Lead, LeadStatus } from "@/lib/services/leads";
import type { Appointment } from "@/lib/services/appointments";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Label, TextInput, TextArea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/states";
import { CloseIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";

const LEAD_STATUS_TONE: Record<LeadStatus, BadgeTone> = {
  new: "accent",
  contacted: "neutral",
  qualified: "warning",
  appointment_booked: "success",
  converted: "success",
  lost: "danger",
};

interface RelatedData {
  conversations: Conversation[];
  leads: Lead[];
  appointments: Appointment[];
}

export function CustomerDetailPanel({
  customer,
  onClose,
}: {
  customer: Customer;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const [related, setRelated] = useState<RelatedData | null>(null);
  const [fullName, setFullName] = useState(customer.fullName ?? "");
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [notes, setNotes] = useState(customer.notes ?? "");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/customers/${customer.id}/related`)
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && json.ok) setRelated(json);
      });
    return () => {
      cancelled = true;
    };
  }, [customer.id]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleSave() {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/customers/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim() || null,
          phone: phone.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) throw new Error();
      showToast("Customer updated", "success");
    } catch {
      showToast("Failed to save changes", "danger");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40">
      <div
        className="h-full w-full max-w-md overflow-y-auto border-l border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">
            {customer.fullName ?? "Unnamed customer"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted hover:bg-surface-hover hover:text-foreground"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="detail-name">Full name</Label>
            <TextInput id="detail-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="detail-phone">Phone</Label>
            <TextInput id="detail-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="detail-notes">Notes</Label>
            <TextArea id="detail-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button size="sm" onClick={handleSave} isLoading={isSaving}>
            Save changes
          </Button>
        </div>

        <hr className="my-6 border-border" />

        {!related ? (
          <div className="flex justify-center py-8">
            <Spinner className="text-muted" />
          </div>
        ) : (
          <div className="space-y-6">
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Conversations
              </h3>
              {related.conversations.length === 0 ? (
                <p className="text-sm text-muted">No conversations yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {related.conversations.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/app/inbox/${c.id}`}
                        className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-surface-hover"
                      >
                        <span className="text-foreground">
                          {c.status === "open" ? "Open" : c.status === "needs_attention" ? "Needs attention" : "Closed"}
                        </span>
                        <Badge tone={c.mode === "human" ? "warning" : "accent"}>
                          {c.mode === "human" ? "Human" : "AI"}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Leads</h3>
              {related.leads.length === 0 ? (
                <p className="text-sm text-muted">No leads yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {related.leads.map((lead) => (
                    <li key={lead.id} className="flex items-center justify-between px-2 py-1.5 text-sm">
                      <span className="text-foreground">{lead.source}</span>
                      <Badge tone={LEAD_STATUS_TONE[lead.status]}>{lead.status.replace(/_/g, " ")}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Appointments
              </h3>
              {related.appointments.length === 0 ? (
                <p className="text-sm text-muted">No appointments yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {related.appointments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between px-2 py-1.5 text-sm">
                      <span className="text-foreground">{formatDateTime(a.scheduledAt)}</span>
                      <Badge tone={a.status === "scheduled" ? "accent" : a.status === "completed" ? "success" : "neutral"}>
                        {a.status.replace(/_/g, " ")}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
