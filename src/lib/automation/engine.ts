import "server-only";
import type {
  AutomationTriggerEvent,
  AutomationActionConfig,
  AutomationActionStep,
} from "@/lib/automation/types";
import { evaluateConditions, type ConditionContext } from "@/lib/automation/conditions";
import { checkStopConditions } from "@/lib/automation/stop-conditions";
import {
  listActiveAutomationsForTrigger,
  createAutomationRun,
  createAutomationRunStep,
  updateAutomationRunStatus,
  cancelPendingStepsForRun,
  markStepCompleted,
  markStepFailed,
  retryStep,
  claimDueAutomationSteps,
  getAutomation,
  type Automation,
  type AutomationRun,
  type DueStepWithContext,
} from "@/lib/services/automations";
import { getCustomer } from "@/lib/services/customers";
import { getLead, setLeadNextFollowUpAt, updateLead as updateLeadService } from "@/lib/services/leads";
import { getConversation, updateConversationStatus, findOrCreateOpenConversation } from "@/lib/services/conversations";
import { getBusinessSettings } from "@/lib/services/business-settings";
import { searchCourses } from "@/lib/services/courses";
import { appendMessage, listRecentMessages, hasReceivedPriorReply } from "@/lib/services/messages";
import { createFollowUp } from "@/lib/services/follow-ups";
import { getTelegramIntegrationByOrganizationId } from "@/lib/services/telegram-integrations";
import { sendTelegramMessage } from "@/lib/telegram/client";
import { stripMarkdownForTelegram } from "@/lib/telegram/format";
import { runAgent } from "@/lib/ai/agent";
import { resolveCustomerLanguage } from "@/lib/services/customers";

const MAX_STEP_RETRIES = 3;
const RETRY_BACKOFF_MINUTES = [5, 30, 120];

/**
 * Called from every trigger point (create-lead/update-lead/create-appointment/
 * cancel-appointment tool handlers, and the webhook route's
 * needs_attention path) — never from anywhere the AI model could influence
 * which organization/trigger fires. Looks up this org's ACTIVE automations
 * for triggerType, evaluates each one's conditions against the resolved
 * event context, and starts a run (+ schedules its first step) for every
 * match. Never throws to the caller on a per-automation failure — a single
 * misconfigured automation must not break the lead/appointment/webhook
 * operation that triggered it (same fire-and-forget-safe philosophy as the
 * rest of this codebase's non-critical writes).
 */
export async function dispatchTrigger(event: AutomationTriggerEvent): Promise<void> {
  try {
    const automations = await listActiveAutomationsForTrigger(event.organizationId, event.type);
    if (automations.length === 0) return;

    const context = await buildConditionContext(event);

    for (const automation of automations) {
      try {
        if (!evaluateConditions(automation.conditions, context)) continue;
        await startRun(automation, event);
      } catch (err) {
        console.error(`dispatchTrigger: automation ${automation.id} failed to start:`, err);
      }
    }
  } catch (err) {
    console.error("dispatchTrigger failed:", err);
  }
}

async function buildConditionContext(event: AutomationTriggerEvent): Promise<ConditionContext> {
  const context: ConditionContext = {};
  const settings = await getBusinessSettings(event.organizationId);
  if (settings) {
    context.businessHours = { workingHours: settings.workingHours, timezone: settings.timezone };
  }

  const customer = await getCustomer(event.organizationId, event.customerId);
  context.customerLanguage = customer?.language ?? null;

  switch (event.type) {
    case "lead_created": {
      const lead = await getLead(event.organizationId, event.leadId);
      context.leadStatus = lead?.status;
      context.leadSource = lead?.source;
      context.courseId = lead?.courseId ?? null;
      break;
    }
    case "lead_status_changed": {
      context.leadStatus = event.newStatus;
      const lead = await getLead(event.organizationId, event.leadId);
      context.leadSource = lead?.source;
      context.courseId = lead?.courseId ?? null;
      break;
    }
    case "appointment_created":
    case "appointment_cancelled":
      context.appointmentStatus = event.type === "appointment_created" ? "scheduled" : "cancelled";
      break;
    case "conversation_needs_attention": {
      const conversation = await getConversation(event.organizationId, event.conversationId);
      context.conversationStatus = conversation?.status;
      break;
    }
  }

  return context;
}

/** Deterministic idempotency key per event — matches (automation_id,
 * trigger_event_id)'s unique index, so re-dispatching the same underlying
 * event (e.g. a retried webhook re-invoking update_lead with the same
 * status transition) never starts a second run for the same automation. */
function triggerEventId(event: AutomationTriggerEvent): string {
  switch (event.type) {
    case "lead_created":
      return `lead_created:${event.leadId}`;
    case "lead_status_changed":
      return `lead_status_changed:${event.leadId}:${event.previousStatus}->${event.newStatus}`;
    case "appointment_created":
      return `appointment_created:${event.appointmentId}`;
    case "appointment_cancelled":
      return `appointment_cancelled:${event.appointmentId}`;
    case "conversation_needs_attention":
      return `conversation_needs_attention:${event.conversationId}`;
  }
}

async function startRun(automation: Automation, event: AutomationTriggerEvent): Promise<void> {
  const conversationId =
    "conversationId" in event
      ? event.conversationId
      : (await findOrCreateOpenConversation(event.organizationId, event.customerId)).id;

  const result = await createAutomationRun(event.organizationId, {
    automationId: automation.id,
    customerId: event.customerId,
    conversationId,
    leadId: "leadId" in event ? event.leadId : null,
    appointmentId: "appointmentId" in event ? event.appointmentId : null,
    triggerEventId: triggerEventId(event),
  });

  if (!result.ok) return; // duplicate_trigger_event — already started, nothing to do.

  if (automation.actions.length === 0) {
    await updateAutomationRunStatus(event.organizationId, result.run.id, "completed");
    return;
  }

  await scheduleStep(event.organizationId, result.run.id, automation.actions, 0, new Date());
}

/** Schedules step `index` of `actions`, `waitBeforeMinutes` after `from`. */
async function scheduleStep(
  organizationId: string,
  runId: string,
  actions: AutomationActionStep[],
  index: number,
  from: Date
): Promise<void> {
  const step = actions[index];
  if (!step) {
    await updateAutomationRunStatus(organizationId, runId, "completed");
    return;
  }
  const scheduledAt = new Date(from.getTime() + step.waitBeforeMinutes * 60_000);
  await createAutomationRunStep(organizationId, {
    runId,
    stepIndex: index,
    actionType: step.action.type,
    actionConfig: step.action as unknown as Record<string, unknown>,
    scheduledAt: scheduledAt.toISOString(),
  });
}

// ----------------------------------------------------------------------------
// Cron-side execution
// ----------------------------------------------------------------------------

export interface RunAutomationsResult {
  claimed: number;
  completed: number;
  stopped: number;
  skippedHumanTakeover: number;
  failed: number;
}

/** Called by the automations cron route. Claims every currently-due step
 * (atomically — see claimDueAutomationSteps) and executes each one in
 * turn. Never throws per-step — a single step's failure is recorded on
 * that step/run and does not stop the batch. */
export async function runDueAutomationSteps(): Promise<RunAutomationsResult> {
  const now = new Date().toISOString();
  const dueSteps = await claimDueAutomationSteps(now);

  const result: RunAutomationsResult = { claimed: dueSteps.length, completed: 0, stopped: 0, skippedHumanTakeover: 0, failed: 0 };

  for (const step of dueSteps) {
    const outcome = await runDueStep(step);
    result[outcome]++;
  }

  return result;
}

async function runDueStep(step: DueStepWithContext): Promise<"completed" | "stopped" | "skippedHumanTakeover" | "failed"> {
  const { run } = step;
  const organizationId = run.organizationId;

  try {
    if (run.status !== "active") {
      // Run was cancelled/stopped by another path (e.g. dashboard "stop
      // run", or a previous step in this same batch already stopped it)
      // between being claimed and now — do not execute.
      await markStepCompleted(organizationId, step.id);
      return "stopped";
    }

    const automation = await getAutomationOrThrow(organizationId, step);
    const stopReason = await checkStopConditions(run, automation.stopConditions);
    if (stopReason) {
      await updateAutomationRunStatus(organizationId, run.id, "stopped", stopReason);
      await cancelPendingStepsForRun(organizationId, run.id);
      await markStepCompleted(organizationId, step.id);
      return "stopped";
    }

    // Human takeover check — applies to EVERY action type, not just
    // send_ai_message: if a human has taken over this conversation, no
    // automated action (including a plain templated send_message or a
    // needs_attention flag that would look like a duplicate escalation)
    // should fire on the AI's behalf. Skipped (not failed, not
    // completed-as-if-sent) so it's visible in observability as
    // distinct from a real failure.
    if (run.conversationId) {
      const conversation = await getConversation(organizationId, run.conversationId);
      if (conversation?.mode === "human") {
        await markStepCompleted(organizationId, step.id);
        await advanceRun(organizationId, run.id, automation, step.stepIndex);
        return "skippedHumanTakeover";
      }
    }

    const config = step.actionConfig as unknown as AutomationActionConfig;
    await executeAction(organizationId, run, config);

    await markStepCompleted(organizationId, step.id);
    await advanceRun(organizationId, run.id, automation, step.stepIndex);
    return "completed";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`runDueStep: step ${step.id} failed:`, message);

    if (step.retryCount < MAX_STEP_RETRIES) {
      const backoffMinutes = RETRY_BACKOFF_MINUTES[step.retryCount] ?? RETRY_BACKOFF_MINUTES[RETRY_BACKOFF_MINUTES.length - 1];
      const nextScheduledAt = new Date(Date.now() + backoffMinutes * 60_000).toISOString();
      await retryStep(organizationId, step.id, step.retryCount + 1, nextScheduledAt);
    } else {
      await markStepFailed(organizationId, step.id, message);
    }
    return "failed";
  }
}

async function getAutomationOrThrow(organizationId: string, step: DueStepWithContext): Promise<Automation> {
  const automation = await getAutomation(organizationId, step.run.automationId);
  if (!automation) throw new Error(`automation ${step.run.automationId} not found`);
  return automation;
}

async function advanceRun(organizationId: string, runId: string, automation: Automation, completedIndex: number): Promise<void> {
  const nextIndex = completedIndex + 1;
  if (nextIndex >= automation.actions.length) {
    await updateAutomationRunStatus(organizationId, runId, "completed");
    return;
  }
  await scheduleStep(organizationId, runId, automation.actions, nextIndex, new Date());
}

// ----------------------------------------------------------------------------
// Action execution — reuses the existing Telegram send path and AI agent.
// No second AI implementation, no second Telegram client.
// ----------------------------------------------------------------------------

async function executeAction(organizationId: string, run: AutomationRun, config: AutomationActionConfig): Promise<void> {
  switch (config.type) {
    case "send_message":
      await sendPlainMessage(organizationId, run, config.message);
      return;
    case "send_ai_message":
      await sendAiMessage(organizationId, run, config.instruction);
      return;
    case "create_follow_up": {
      if (!run.leadId) throw new Error("create_follow_up action requires a run with a leadId");
      const dueAt = new Date(Date.now() + config.dueInMinutes * 60_000).toISOString();
      await createFollowUp(organizationId, {
        leadId: run.leadId,
        customerId: run.customerId,
        dueAt,
        message: config.message,
      });
      await setLeadNextFollowUpAt(organizationId, run.leadId, dueAt);
      return;
    }
    case "update_lead": {
      if (!run.leadId) throw new Error("update_lead action requires a run with a leadId");
      await updateLeadService(organizationId, run.leadId, { status: config.status });
      return;
    }
    case "mark_conversation_needs_attention": {
      if (!run.conversationId) throw new Error("mark_conversation_needs_attention action requires a run with a conversationId");
      await updateConversationStatus(organizationId, run.conversationId, "needs_attention");
      return;
    }
    case "notify_staff": {
      // No email/SMS/push infrastructure exists in this project (out of
      // M6 scope) — the smallest viable "staff notification" reuses the
      // exact mechanism M4 already built for surfacing conversations that
      // need a human: needs_attention status, visible in the dashboard's
      // Inbox filter. The message is stored as a system message on the
      // conversation so staff see WHY it was flagged.
      if (!run.conversationId) throw new Error("notify_staff action requires a run with a conversationId");
      await appendMessage(organizationId, {
        conversationId: run.conversationId,
        sender: "system",
        content: config.message,
      });
      await updateConversationStatus(organizationId, run.conversationId, "needs_attention");
      return;
    }
  }
}

async function sendPlainMessage(organizationId: string, run: AutomationRun, message: string): Promise<void> {
  const { customer, integration } = await resolveSendTargets(organizationId, run.customerId);
  if (!customer.telegramChatId || !integration) return; // nothing to send to — not an error, just unreachable.

  const text = stripMarkdownForTelegram(message);
  const sendResult = await sendTelegramMessage({
    botToken: integration.botToken,
    chatId: customer.telegramChatId,
    text,
    businessConnectionId: integration.businessConnectionEnabled ? (integration.businessConnectionId ?? undefined) : undefined,
  });

  if (run.conversationId) {
    await appendMessage(organizationId, { conversationId: run.conversationId, sender: "ai", content: text });
  }

  if (!sendResult.ok) throw new Error(`Telegram send failed: ${sendResult.description ?? "unknown error"}`);
}

/**
 * Reuses the EXACT same runAgent() the Telegram webhook uses — same tool
 * set, same business-settings/course-snapshot/M5 language-context
 * plumbing, same Markdown-stripping before send. `instruction` (if given)
 * is passed as an additional system-level hint appended to the automation's
 * own context, not as a replacement for the real conversation history —
 * the model still sees the customer's actual message history and answers
 * as the same receptionist, just prompted to address this specific
 * automation purpose (e.g. "check in since they went quiet").
 */
async function sendAiMessage(organizationId: string, run: AutomationRun, instruction?: string): Promise<void> {
  if (!run.conversationId) throw new Error("send_ai_message action requires a run with a conversationId");

  const { customer, integration } = await resolveSendTargets(organizationId, run.customerId);
  if (!customer.telegramChatId || !integration) return;

  const [settings, recentMessages, hasPriorReply, activeCourses] = await Promise.all([
    getBusinessSettings(organizationId),
    listRecentMessages(organizationId, run.conversationId, 21),
    hasReceivedPriorReply(organizationId, run.customerId),
    searchCourses(organizationId),
  ]);

  const history = recentMessages.reverse();
  const isFirstReply = !hasPriorReply;
  // Resolved from an empty signal, never from `instruction` — the
  // instruction text is an internal automation directive, not something
  // the customer wrote, so it must never be fed into language DETECTION
  // (which would risk misreading it as the customer's own words and
  // overriding their real established language). An empty message makes
  // detectLanguage() return null, so resolveCustomerLanguage falls
  // through to the customer's already-stored language/default, per its
  // own documented precedence (see services/customers.ts).
  const resolvedLanguage = resolveCustomerLanguage(customer, "", settings);

  const automationPrompt =
    instruction?.trim()
      ? `[Automated follow-up — not a message the customer sent] ${instruction.trim()}`
      : "[Automated follow-up] Send a brief, natural check-in to this customer based on the conversation so far — do not claim anything new happened, just re-engage naturally.";

  const agentResponse = await runAgent({
    systemContext: { organizationId, conversationId: run.conversationId, customerId: run.customerId },
    history,
    incomingText: automationPrompt,
    isFirstReply,
    businessSettings: settings,
    activeCourses: isFirstReply ? activeCourses : undefined,
    languageContext: {
      customerLanguage: resolvedLanguage.language,
      languageSource: resolvedLanguage.source,
      supportedLanguages: settings?.languages ?? ["en"],
      defaultLanguage: settings?.defaultLanguage ?? "en",
    },
  });

  const text = stripMarkdownForTelegram(agentResponse.text);
  const sendResult = await sendTelegramMessage({
    botToken: integration.botToken,
    chatId: customer.telegramChatId,
    text,
    businessConnectionId: integration.businessConnectionEnabled ? (integration.businessConnectionId ?? undefined) : undefined,
  });

  await appendMessage(organizationId, { conversationId: run.conversationId, sender: "ai", content: text });

  if (!sendResult.ok) throw new Error(`Telegram send failed: ${sendResult.description ?? "unknown error"}`);
}

async function resolveSendTargets(organizationId: string, customerId: string) {
  const [customer, integration] = await Promise.all([
    getCustomer(organizationId, customerId),
    getTelegramIntegrationByOrganizationId(organizationId),
  ]);
  if (!customer) throw new Error(`customer ${customerId} not found`);
  return { customer, integration };
}
