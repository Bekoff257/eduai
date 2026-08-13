import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export async function logAiAction(
  organizationId: string,
  input: {
    conversationId?: string;
    toolName: string;
    input: unknown;
    output: unknown;
    status: "success" | "failure";
    errorMessage?: string;
  }
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("ai_actions").insert({
    organization_id: organizationId,
    conversation_id: input.conversationId ?? null,
    tool_name: input.toolName,
    input: input.input ?? {},
    output: input.output ?? {},
    status: input.status,
    error_message: input.errorMessage ?? null,
  });

  // Logging failures should never break the agent's response to the
  // customer — log to stderr and move on rather than throwing.
  if (error) {
    console.error(`logAiAction failed for tool ${input.toolName}:`, error.message);
  }
}
