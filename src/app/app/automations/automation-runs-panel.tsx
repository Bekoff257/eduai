"use client";

import { useEffect, useState } from "react";
import type { AutomationRunListItem } from "@/lib/services/automations";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/format";

const RUN_STATUS_TONE: Record<AutomationRunListItem["status"], BadgeTone> = {
  active: "accent",
  completed: "success",
  stopped: "warning",
  cancelled: "neutral",
};

/** Lazy-loaded execution history for one automation — fetched only when
 * its row is expanded (see automations-client.tsx), so the list page
 * itself stays a single cheap query. */
export function AutomationRunsPanel({ automationId }: { automationId: string }) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error" } | { status: "ready"; runs: AutomationRunListItem[]; totalCount: number }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/automations/${automationId}/runs`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.ok) throw new Error();
        setState({ status: "ready", runs: json.runs, totalCount: json.totalCount });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [automationId]);

  if (state.status === "loading") {
    return <p className="text-xs text-muted">Loading execution history…</p>;
  }
  if (state.status === "error") {
    return <p className="text-xs text-danger">Failed to load execution history.</p>;
  }
  if (state.runs.length === 0) {
    return <p className="text-xs text-muted">No runs yet — this automation hasn&apos;t triggered for any customer.</p>;
  }

  const failedCount = state.runs.filter((r) => r.hasFailedStep).length;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-foreground">
        {state.totalCount} run{state.totalCount === 1 ? "" : "s"}
        {failedCount > 0 && <span className="ml-1.5 text-danger">({failedCount} with a failed step)</span>}
      </p>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-background/50 text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Started</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {state.runs.map((run) => (
              <tr key={run.id}>
                <td className="px-3 py-2 text-foreground">{run.customerName ?? "Unknown"}</td>
                <td className="px-3 py-2">
                  <Badge tone={run.hasFailedStep ? "danger" : RUN_STATUS_TONE[run.status]}>
                    {run.hasFailedStep ? "failed step" : run.status}
                    {run.stoppedReason ? ` — ${run.stoppedReason.replace(/_/g, " ")}` : ""}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-muted">{formatRelativeTime(run.startedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
