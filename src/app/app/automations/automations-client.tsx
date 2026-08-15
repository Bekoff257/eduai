"use client";

import { useState } from "react";
import type { Automation } from "@/lib/services/automations";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { PlusIcon, ChevronDownIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { AutomationFormModal } from "@/app/app/automations/automation-form-modal";
import { AutomationRunsPanel } from "@/app/app/automations/automation-runs-panel";
import { TRIGGER_LABELS } from "@/app/app/automations/labels";

const STATUS_TONE: Record<Automation["status"], BadgeTone> = {
  active: "success",
  paused: "warning",
  archived: "neutral",
};

export function AutomationsClient({
  initialAutomations,
  canManage,
}: {
  initialAutomations: Automation[];
  canManage: boolean;
}) {
  const { showToast } = useToast();
  const [automations, setAutomations] = useState(initialAutomations);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [formAutomation, setFormAutomation] = useState<Automation | "new" | null>(null);

  const visible = automations.filter((a) => a.status !== "archived");
  const archived = automations.filter((a) => a.status === "archived");

  async function toggleStatus(automation: Automation) {
    const nextStatus = automation.status === "active" ? "paused" : "active";
    try {
      const res = await fetch(`/api/automations/${automation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Failed to update");
      setAutomations((prev) => prev.map((a) => (a.id === automation.id ? json.automation : a)));
      showToast(nextStatus === "active" ? "Automation enabled" : "Automation paused", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update", "danger");
    }
  }

  async function handleArchive(automation: Automation) {
    if (!confirm(`Archive "${automation.name}"? It will stop running but its history is kept.`)) return;
    try {
      const res = await fetch(`/api/automations/${automation.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setAutomations((prev) => prev.map((a) => (a.id === automation.id ? { ...a, status: "archived" } : a)));
      showToast(`"${automation.name}" archived`, "success");
    } catch {
      showToast("Failed to archive automation", "danger");
    }
  }

  function renderRow(automation: Automation) {
    const isExpanded = expandedId === automation.id;
    return (
      <Card key={automation.id} className="overflow-hidden">
        <div className="flex items-center gap-3 p-4">
          <button
            type="button"
            onClick={() => setExpandedId(isExpanded ? null : automation.id)}
            className="flex flex-1 items-center gap-3 text-left"
          >
            <ChevronDownIcon className={`h-4 w-4 shrink-0 text-muted transition-transform ${isExpanded ? "rotate-180" : ""}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium text-foreground">{automation.name}</p>
                <Badge tone={STATUS_TONE[automation.status]}>{automation.status}</Badge>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted">
                When {TRIGGER_LABELS[automation.triggerType]} · {automation.actions.length} action
                {automation.actions.length === 1 ? "" : "s"}
              </p>
            </div>
          </button>
          {canManage && automation.status !== "archived" && (
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => toggleStatus(automation)}>
                {automation.status === "active" ? "Pause" : "Enable"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setFormAutomation(automation)}>
                Edit
              </Button>
              <Button variant="ghost" size="sm" onClick={() => handleArchive(automation)}>
                Archive
              </Button>
            </div>
          )}
        </div>

        {isExpanded && (
          <div className="border-t border-border bg-background/50 p-4">
            <AutomationRunsPanel automationId={automation.id} />
          </div>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Automations</h1>
          <p className="mt-1 text-sm text-muted">
            Configure trigger → condition → action sequences your AI receptionist runs automatically.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setFormAutomation("new")}>
            <PlusIcon className="h-4 w-4" />
            New automation
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="No automations yet"
          description={
            canManage
              ? "Create one to automatically follow up on new leads, remind customers before appointments, or notify staff when something needs attention."
              : undefined
          }
          action={
            canManage ? (
              <Button onClick={() => setFormAutomation("new")}>
                <PlusIcon className="h-4 w-4" />
                New automation
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">{visible.map(renderRow)}</div>
      )}

      {archived.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted hover:text-foreground">
            {archived.length} archived automation{archived.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-3 space-y-3">{archived.map(renderRow)}</div>
        </details>
      )}

      {formAutomation && (
        <AutomationFormModal
          automation={formAutomation === "new" ? null : formAutomation}
          onClose={() => setFormAutomation(null)}
          onSaved={(saved) => {
            setAutomations((prev) => {
              const exists = prev.some((a) => a.id === saved.id);
              return exists ? prev.map((a) => (a.id === saved.id ? saved : a)) : [saved, ...prev];
            });
            setFormAutomation(null);
            showToast(`"${saved.name}" saved`, "success");
          }}
        />
      )}
    </div>
  );
}
