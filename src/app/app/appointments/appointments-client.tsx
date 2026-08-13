"use client";

import { useState } from "react";
import Link from "next/link";
import type { AppointmentListItem, Appointment } from "@/lib/services/appointments";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { Pagination } from "@/components/ui/pagination";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";

type AppointmentStatus = Appointment["status"];

const STATUS_TONE: Record<AppointmentStatus, BadgeTone> = {
  scheduled: "accent",
  completed: "success",
  cancelled: "neutral",
  no_show: "danger",
};

const STATUS_OPTIONS: AppointmentStatus[] = ["scheduled", "completed", "cancelled", "no_show"];

export function AppointmentsClient({
  initialAppointments,
  totalCount,
  timeframe,
  page,
}: {
  initialAppointments: AppointmentListItem[];
  totalCount: number;
  timeframe: "upcoming" | "past";
  page: number;
}) {
  const { showToast } = useToast();
  const [appointments, setAppointments] = useState(initialAppointments);

  function buildHref(nextTimeframe: "upcoming" | "past", nextPage = 1) {
    const params = new URLSearchParams();
    if (nextTimeframe === "past") params.set("timeframe", "past");
    if (nextPage > 1) params.set("page", String(nextPage));
    return `/app/appointments${params.toString() ? `?${params}` : ""}`;
  }

  async function handleStatusChange(appointmentId: string, status: AppointmentStatus) {
    const prev = appointments;
    setAppointments((cur) => cur.map((a) => (a.id === appointmentId ? { ...a, status } : a)));
    try {
      const res = await fetch(`/api/appointments/${appointmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      showToast("Appointment updated", "success");
    } catch {
      setAppointments(prev);
      showToast("Failed to update appointment", "danger");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Appointments</h1>
        <p className="mt-1 text-sm text-muted">Trial lessons and bookings confirmed by your AI receptionist.</p>
      </div>

      <div className="flex gap-1.5">
        <Link
          href={buildHref("upcoming")}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            timeframe === "upcoming" ? "bg-accent/10 text-accent" : "text-foreground/80 hover:bg-surface-hover"
          }`}
        >
          Upcoming
        </Link>
        <Link
          href={buildHref("past")}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            timeframe === "past" ? "bg-accent/10 text-accent" : "text-foreground/80 hover:bg-surface-hover"
          }`}
        >
          Past
        </Link>
      </div>

      {appointments.length === 0 ? (
        <EmptyState
          title={timeframe === "upcoming" ? "No upcoming appointments" : "No past appointments"}
          description={
            timeframe === "upcoming"
              ? "Trial lessons and bookings your AI receptionist confirms will appear here."
              : undefined
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Course / group</th>
                  <th className="px-4 py-3 font-medium">Scheduled</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {appointments.map((appointment) => (
                  <tr key={appointment.id}>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {appointment.customerName ?? "Unknown"}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {appointment.courseName} &middot; {appointment.courseGroupName}
                    </td>
                    <td className="px-4 py-3 text-muted">{formatDateTime(appointment.scheduledAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Badge tone={STATUS_TONE[appointment.status]}>
                          {appointment.status.replace(/_/g, " ")}
                        </Badge>
                        <Select
                          value={appointment.status}
                          onChange={(e) =>
                            handleStatusChange(appointment.id, e.target.value as AppointmentStatus)
                          }
                          className="w-auto py-1 text-xs"
                          aria-label={`Change status for ${appointment.customerName ?? "appointment"}`}
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>
                              {s.replace(/_/g, " ")}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 pb-4">
            <Pagination page={page} pageSize={20} totalCount={totalCount} buildHref={(p) => buildHref(timeframe, p)} />
          </div>
        </Card>
      )}
    </div>
  );
}
