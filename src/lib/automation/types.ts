/**
 * Structured shapes for automations.conditions/actions (jsonb columns) —
 * validated at the application layer (see automations.ts's Zod schemas),
 * not by a DB check constraint, so new condition/action types don't need a
 * migration. Kept deliberately small (per M6 scope) — add a new
 * ConditionField/ActionType here plus one evaluator/executor case in
 * engine.ts, not a new subsystem.
 */

export type AutomationTriggerType =
  | "lead_created"
  | "lead_status_changed"
  | "appointment_created"
  | "appointment_cancelled"
  | "conversation_needs_attention";

export type AutomationStatus = "active" | "paused" | "archived";
export type AutomationRunStatus = "active" | "completed" | "stopped" | "cancelled";
export type AutomationStepStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type AutomationStopCondition =
  | "customer_replied"
  | "appointment_created"
  | "lead_closed"
  | "automation_cancelled";

export type ConditionField =
  | "lead_status"
  | "lead_source"
  | "customer_language"
  | "course_id"
  | "appointment_status"
  | "conversation_status"
  | "business_hours";

export type ConditionOperator = "equals" | "not_equals" | "in";

/** One AND-combined clause. `value` is a single value for equals/not_equals,
 * or an array for `in`. For business_hours, field has no `value` — it
 * always checks "is the business currently open" via checkBusinessHours. */
export interface AutomationCondition {
  field: ConditionField;
  operator: ConditionOperator;
  value?: string | string[];
}

export type AutomationActionType =
  | "send_message"
  | "send_ai_message"
  | "create_follow_up"
  | "update_lead"
  | "mark_conversation_needs_attention"
  | "notify_staff";

/** Config per action type — a discriminated union keyed by `type` so each
 * action only carries the fields it actually needs. */
export type AutomationActionConfig =
  | { type: "send_message"; message: string }
  | { type: "send_ai_message"; instruction?: string }
  | { type: "create_follow_up"; message?: string; dueInMinutes: number }
  | { type: "update_lead"; status: "new" | "contacted" | "qualified" | "appointment_booked" | "converted" | "lost" }
  | { type: "mark_conversation_needs_attention" }
  | { type: "notify_staff"; message: string };

/** One step in an automation's ordered action sequence — `waitBeforeMinutes`
 * is the delay BEFORE this action runs, relative to the previous step
 * completing (or to the run starting, for the first step). 0 means
 * immediate. */
export interface AutomationActionStep {
  action: AutomationActionConfig;
  waitBeforeMinutes: number;
}

/** The event payload passed into dispatchTrigger() — deliberately narrow
 * and typed per trigger, never a bag of arbitrary AI-supplied fields. Every
 * field here comes from server-resolved state (a real leads/appointments/
 * conversations row), never from model output. */
export type AutomationTriggerEvent =
  | { type: "lead_created"; organizationId: string; leadId: string; customerId: string }
  | {
      type: "lead_status_changed";
      organizationId: string;
      leadId: string;
      customerId: string;
      previousStatus: string;
      newStatus: string;
    }
  | { type: "appointment_created"; organizationId: string; appointmentId: string; customerId: string; leadId: string | null }
  | { type: "appointment_cancelled"; organizationId: string; appointmentId: string; customerId: string }
  | { type: "conversation_needs_attention"; organizationId: string; conversationId: string; customerId: string };
