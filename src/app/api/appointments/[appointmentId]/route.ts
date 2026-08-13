import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgApiAuth } from "@/lib/dashboard/api-auth";
import { updateAppointmentStatus } from "@/lib/services/appointments";

const updateSchema = z.object({
  status: z.enum(["scheduled", "completed", "cancelled", "no_show"]),
});

/**
 * Status transitions only (complete/cancel/mark no-show) — this
 * deliberately does NOT support creating or rescheduling appointments,
 * which must go through the atomic book_appointment_atomic() RPC
 * (src/lib/services/appointments.ts#createAppointment) to preserve the
 * race-safe capacity guarantee. There is no reschedule endpoint for the
 * same reason: changing scheduled_at is equivalent to a new booking.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ appointmentId: string }> }
) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;
  const { appointmentId } = await params;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const appointment = await updateAppointmentStatus(auth.organization.id, appointmentId, parsed.data.status);
  if (!appointment) {
    return NextResponse.json({ ok: false, error: "Appointment not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, appointment });
}
