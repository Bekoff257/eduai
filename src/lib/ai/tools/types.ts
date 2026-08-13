import type { z } from "zod";
import type { ToolContext, ToolResult } from "@/lib/ai/types";

/**
 * A tool's Zod schema must never include an organization_id (or any
 * tenant-identifying) field — organizationId always comes from ToolContext,
 * which the webhook/agent derives server-side from the resolved Telegram
 * integration, never from the model's tool-call arguments. This is what
 * makes "the AI cannot supply a trusted organization_id" true by
 * construction rather than by convention.
 */
export interface ToolDefinition<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  schema: z.ZodType<Input>;
  handler: (input: Input, context: ToolContext) => Promise<ToolResult<Output>>;
}

/**
 * A type-erased tool, safe to hold in a heterogeneous array/registry. The
 * handler's input type is intentionally unknown here — callers must go
 * through schema.safeParse() first (which agent.ts does), never call
 * handler directly with unvalidated data.
 */
export type AnyToolDefinition = {
  name: string;
  description: string;
  schema: z.ZodType;
  handler: (input: never, context: ToolContext) => Promise<ToolResult>;
};

export function defineTool<Input, Output>(
  definition: ToolDefinition<Input, Output>
): AnyToolDefinition {
  // Contravariance in handler's Input parameter means ToolDefinition<Input>
  // is not assignable to ToolDefinition<unknown> — this cast is the
  // deliberate, single erasure point. Safety is restored at the call site
  // in agent.ts, which always validates input via schema.safeParse()
  // before invoking handler, so handler never actually runs with an
  // improperly-shaped input despite the erased type.
  return definition as unknown as AnyToolDefinition;
}
