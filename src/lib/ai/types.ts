/**
 * Channel-agnostic message/response shapes. The AI agent (agent.ts) and
 * tools only ever see these types — never anything Telegram-specific.
 * Adding a second channel later means writing a new normalize.ts that
 * produces an InboundMessage, not touching the agent or tools.
 */

export type Channel = "telegram";

export interface InboundMessage {
  channel: Channel;
  organizationId: string;
  externalUserId: string;
  messageId: string;
  text: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface AgentAction {
  tool: string;
  status: "success" | "failure";
  summary: string;
}

export interface AgentResponse {
  text: string;
  actions: AgentAction[];
  leadUpdated: boolean;
  appointmentCreated: boolean;
  /** True whenever the agent fell back to its safe failure text instead
   * of a real model response (client construction error, OpenRouter
   * request failure, or exhausting MAX_TOOL_ROUNDS) — see agent.ts. The
   * caller (the webhook route) uses this to flag the conversation as
   * needing human attention, since the AI could not actually help here. */
  needsHumanAttention: boolean;
}

/**
 * Every tool handler receives this instead of trusting anything from the
 * model's tool-call arguments for authorization. organizationId here is
 * derived server-side from the resolved Telegram integration — the model
 * never supplies it, and any organizationId-shaped field in a tool's Zod
 * input schema is ignored/absent by design (see tools/*).
 */
export interface ToolContext {
  organizationId: string;
  conversationId: string;
  customerId: string;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
