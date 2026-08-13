import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export interface HumanTakeover {
  id: string;
  organizationId: string;
  conversationId: string;
  memberId: string;
  takenOverAt: string;
  returnedToAiAt: string | null;
  reason: string | null;
}

function mapRow(row: {
  id: string;
  organization_id: string;
  conversation_id: string;
  member_id: string;
  taken_over_at: string;
  returned_to_ai_at: string | null;
  reason: string | null;
}): HumanTakeover {
  return {
    id: row.id,
    organizationId: row.organization_id,
    conversationId: row.conversation_id,
    memberId: row.member_id,
    takenOverAt: row.taken_over_at,
    returnedToAiAt: row.returned_to_ai_at,
    reason: row.reason,
  };
}

const SELECT_COLUMNS =
  "id, organization_id, conversation_id, member_id, taken_over_at, returned_to_ai_at, reason";

/**
 * Records that a staff member took over a conversation from the AI.
 * Relies on the existing partial unique index
 * uq_human_takeovers_open_per_conversation (conversation_id) where
 * returned_to_ai_at is null — a second concurrent takeover attempt on the
 * same already-open conversation fails with 23505 rather than creating two
 * open takeover records. Callers are responsible for also flipping
 * conversations.mode to "human" (updateConversationMode) — this table
 * records who/when/why, it doesn't itself gate the AI agent.
 */
export async function createHumanTakeover(
  organizationId: string,
  input: { conversationId: string; memberId: string; reason?: string }
): Promise<{ ok: true; takeover: HumanTakeover } | { ok: false; reason: "already_taken_over" }> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("human_takeovers")
    .insert({
      organization_id: organizationId,
      conversation_id: input.conversationId,
      member_id: input.memberId,
      reason: input.reason ?? null,
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, reason: "already_taken_over" };
    }
    throw new Error(`createHumanTakeover failed: ${error.message}`);
  }

  return { ok: true, takeover: mapRow(data) };
}

/** Closes the currently-open takeover (if any) for a conversation, marking
 * when control returned to the AI. Callers are responsible for also
 * flipping conversations.mode back to "ai". */
export async function resolveHumanTakeover(
  organizationId: string,
  conversationId: string
): Promise<HumanTakeover | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("human_takeovers")
    .update({ returned_to_ai_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .is("returned_to_ai_at", null)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(`resolveHumanTakeover failed: ${error.message}`);
  return data ? mapRow(data) : null;
}

export async function getOpenHumanTakeover(
  organizationId: string,
  conversationId: string
): Promise<HumanTakeover | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("human_takeovers")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .is("returned_to_ai_at", null)
    .maybeSingle();

  if (error) throw new Error(`getOpenHumanTakeover failed: ${error.message}`);
  return data ? mapRow(data) : null;
}
