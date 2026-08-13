import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgApiAuth } from "@/lib/dashboard/api-auth";
import { getMemberId } from "@/lib/dashboard/organizations";
import { getConversation, updateConversationMode, updateConversationStatus } from "@/lib/services/conversations";
import { createHumanTakeover, resolveHumanTakeover } from "@/lib/services/human-takeovers";

const takeoverSchema = z.object({
  action: z.enum(["take_over", "return_to_ai"]),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Real human handoff, backed by human_takeovers + conversations.mode
 * (both already existed in the schema; only the service-layer functions
 * to read/write them were missing before this milestone — see
 * src/lib/services/human-takeovers.ts). take_over flips mode to "human"
 * (the webhook already checks this and will stop invoking the agent) and
 * records who/when/why; return_to_ai flips it back and closes the open
 * takeover record.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;
  const { conversationId } = await params;

  const parsed = takeoverSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const conversation = await getConversation(auth.organization.id, conversationId);
  if (!conversation) {
    return NextResponse.json({ ok: false, error: "Conversation not found" }, { status: 404 });
  }

  if (parsed.data.action === "take_over") {
    const memberId = await getMemberId(auth.user.uid, auth.organization.id);
    if (!memberId) {
      return NextResponse.json({ ok: false, error: "Could not resolve your member record" }, { status: 500 });
    }

    const result = await createHumanTakeover(auth.organization.id, {
      conversationId,
      memberId,
      reason: parsed.data.reason,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: "This conversation already has an active takeover" }, { status: 409 });
    }

    const updated = await updateConversationMode(auth.organization.id, conversationId, "human");
    // A staff member is now actively handling this conversation — clear
    // any needs_attention flag the webhook set (AI failure, undelivered
    // reply). Not cleared on return_to_ai below: handing control back to
    // the AI doesn't mean the underlying issue that flagged it was
    // actually resolved.
    if (conversation.status === "needs_attention") {
      await updateConversationStatus(auth.organization.id, conversationId, "open");
    }
    return NextResponse.json({ ok: true, conversation: updated, takeover: result.takeover });
  }

  await resolveHumanTakeover(auth.organization.id, conversationId);
  const updated = await updateConversationMode(auth.organization.id, conversationId, "ai");
  return NextResponse.json({ ok: true, conversation: updated });
}
