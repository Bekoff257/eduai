import type {
  AutomationTriggerType,
  ConditionField,
  ConditionOperator,
  AutomationActionType,
  AutomationStopCondition,
} from "@/lib/automation/types";

/** Human-readable labels for the automation builder UI. Kept as one small
 * module rather than scattered inline strings so the form and the list
 * view render identical wording. */

export const TRIGGER_LABELS: Record<AutomationTriggerType, string> = {
  lead_created: "a new lead is created",
  lead_status_changed: "a lead's status changes",
  appointment_created: "an appointment is booked",
  appointment_cancelled: "an appointment is cancelled",
  conversation_needs_attention: "a conversation needs attention",
};

export const CONDITION_FIELD_LABELS: Record<ConditionField, string> = {
  lead_status: "Lead status",
  lead_source: "Lead source",
  customer_language: "Customer language",
  course_id: "Course",
  appointment_status: "Appointment status",
  conversation_status: "Conversation status",
  business_hours: "Business is currently open",
};

export const CONDITION_OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: "is",
  not_equals: "is not",
  in: "is one of",
};

export const ACTION_TYPE_LABELS: Record<AutomationActionType, string> = {
  send_message: "Send a message",
  send_ai_message: "Send an AI message",
  create_follow_up: "Create a follow-up",
  update_lead: "Update lead status",
  mark_conversation_needs_attention: "Flag conversation for staff",
  notify_staff: "Notify staff",
};

export const STOP_CONDITION_LABELS: Record<AutomationStopCondition, string> = {
  customer_replied: "Customer replies",
  appointment_created: "An appointment gets booked",
  lead_closed: "Lead is converted or lost",
  automation_cancelled: "Automation is cancelled",
};
