import "server-only";
import type { AutomationCondition } from "@/lib/automation/types";
import type { WorkingHours } from "@/lib/services/business-settings";
import { checkBusinessHours } from "@/lib/business-hours";

/**
 * Everything a condition might need to check, resolved from real
 * server-side data before evaluation ever runs — never partially loaded on
 * demand per-condition, so evaluateConditions() stays a pure, synchronous
 * function with no I/O and no way to leak one organization's data into
 * another's evaluation. Fields are optional because not every trigger
 * produces every fact (e.g. a lead_created event has no appointmentStatus).
 */
export interface ConditionContext {
  leadStatus?: string;
  leadSource?: string;
  customerLanguage?: string | null;
  courseId?: string | null;
  appointmentStatus?: string;
  conversationStatus?: string;
  businessHours?: { workingHours: WorkingHours; timezone: string };
}

/**
 * Deterministic, application-code evaluation — the LLM is never asked to
 * evaluate automation conditions (per M6 scope). All conditions in an
 * automation are AND-combined (v1 has no OR/nesting — the smallest useful
 * set per the M6 plan); an automation with zero conditions always matches.
 */
export function evaluateConditions(conditions: AutomationCondition[], context: ConditionContext): boolean {
  return conditions.every((condition) => evaluateOne(condition, context));
}

function evaluateOne(condition: AutomationCondition, context: ConditionContext): boolean {
  if (condition.field === "business_hours") {
    if (!context.businessHours) return false;
    const { isOpen } = checkBusinessHours(context.businessHours.workingHours, context.businessHours.timezone);
    // business_hours has no meaningful "value" to compare against beyond
    // whether the check itself passes — operator/value are ignored for
    // this field by design (see AutomationCondition's doc comment).
    return isOpen;
  }

  const actual = resolveField(condition.field, context);
  if (actual === undefined) return false;

  switch (condition.operator) {
    case "equals":
      return typeof condition.value === "string" && actual === condition.value;
    case "not_equals":
      return typeof condition.value === "string" && actual !== condition.value;
    case "in":
      return Array.isArray(condition.value) && condition.value.includes(actual);
    default:
      return false;
  }
}

function resolveField(field: AutomationCondition["field"], context: ConditionContext): string | undefined {
  switch (field) {
    case "lead_status":
      return context.leadStatus;
    case "lead_source":
      return context.leadSource;
    case "customer_language":
      return context.customerLanguage ?? undefined;
    case "course_id":
      return context.courseId ?? undefined;
    case "appointment_status":
      return context.appointmentStatus;
    case "conversation_status":
      return context.conversationStatus;
    default:
      return undefined;
  }
}
