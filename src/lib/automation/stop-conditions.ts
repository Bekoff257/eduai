import "server-only";
import type { AutomationRun } from "@/lib/services/automations";
import type { AutomationStopCondition } from "@/lib/automation/types";
import { hasCustomerRepliedSince } from "@/lib/services/messages";
import { listAppointmentsForCustomer } from "@/lib/services/appointments";
import { getLead } from "@/lib/services/leads";

/**
 * Checked before executing each claimed step (see engine.ts's
 * runDueStep) — NOT only at schedule time — so a customer who replies (or
 * an appointment that gets booked, or a lead that closes) AFTER a step was
 * scheduled but BEFORE it was due still correctly prevents that step from
 * firing. This is what stops the "Just following up!" message after a
 * customer already had a real conversation.
 *
 * Returns the first matching stop condition (from the automation's
 * configured list, checked in a fixed order) or null if none apply.
 * Deterministic, application-code checks only — never the LLM.
 */
export async function checkStopConditions(
  run: AutomationRun,
  stopConditions: AutomationStopCondition[]
): Promise<AutomationStopCondition | null> {
  for (const condition of stopConditions) {
    if (await checkOne(condition, run)) return condition;
  }
  return null;
}

async function checkOne(condition: AutomationStopCondition, run: AutomationRun): Promise<boolean> {
  switch (condition) {
    case "customer_replied": {
      if (!run.conversationId) return false;
      return hasCustomerRepliedSince(run.organizationId, run.conversationId, run.startedAt);
    }
    case "appointment_created": {
      // Only meaningful as a stop condition for runs that didn't already
      // start FROM an appointment_created trigger (that would be
      // trivially always-true) — a lead-follow-up automation stopping
      // because the customer booked an appointment in the meantime is the
      // actual use case. Checks for any appointment scheduled for this
      // customer created after the run started.
      const appointments = await listAppointmentsForCustomer(run.organizationId, run.customerId);
      return appointments.some((a) => a.status === "scheduled" && a.id !== run.appointmentId);
    }
    case "lead_closed": {
      if (!run.leadId) return false;
      const lead = await getLead(run.organizationId, run.leadId);
      return lead?.status === "converted" || lead?.status === "lost";
    }
    case "automation_cancelled":
      // Cancellation is a direct status write (see cancelAutomationRun in
      // automations.ts, used by the dashboard's "stop run" action) — by
      // the time checkStopConditions runs, a cancelled run's steps are
      // already cancelled via cancelPendingStepsForRun, so this case
      // should never actually be reached in practice. Kept as an explicit
      // no-op (not a default/fallthrough) so every AutomationStopCondition
      // is handled by name, not by accident.
      return false;
    default: {
      const exhaustive: never = condition;
      return exhaustive;
    }
  }
}
