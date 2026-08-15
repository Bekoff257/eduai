import { z } from "zod";

/** Shared Zod schemas for the automations API routes (POST /api/automations
 * and PATCH /api/automations/[automationId]) — kept in one place so the
 * two routes' validation can never silently drift apart. */

export const conditionSchema = z.object({
  field: z.enum([
    "lead_status",
    "lead_source",
    "customer_language",
    "course_id",
    "appointment_status",
    "conversation_status",
    "business_hours",
  ]),
  operator: z.enum(["equals", "not_equals", "in"]),
  value: z.union([z.string(), z.array(z.string())]).optional(),
});

export const actionConfigSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("send_message"), message: z.string().trim().min(1).max(2000) }),
  z.object({ type: z.literal("send_ai_message"), instruction: z.string().trim().max(2000).optional() }),
  z.object({
    type: z.literal("create_follow_up"),
    message: z.string().trim().max(2000).optional(),
    dueInMinutes: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("update_lead"),
    status: z.enum(["new", "contacted", "qualified", "appointment_booked", "converted", "lost"]),
  }),
  z.object({ type: z.literal("mark_conversation_needs_attention") }),
  z.object({ type: z.literal("notify_staff"), message: z.string().trim().min(1).max(2000) }),
]);

export const actionStepSchema = z.object({
  action: actionConfigSchema,
  waitBeforeMinutes: z.number().int().nonnegative().max(60 * 24 * 30), // cap at 30 days
});

export const stopConditionSchema = z.enum(["customer_replied", "appointment_created", "lead_closed", "automation_cancelled"]);

export const triggerTypeSchema = z.enum([
  "lead_created",
  "lead_status_changed",
  "appointment_created",
  "appointment_cancelled",
  "conversation_needs_attention",
]);
