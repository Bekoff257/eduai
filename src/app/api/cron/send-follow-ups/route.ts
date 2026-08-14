import { NextRequest, NextResponse } from "next/server";
import { listDueFollowUps, markFollowUpSent, markFollowUpFailed } from "@/lib/services/follow-ups";
import { sendTelegramMessage } from "@/lib/telegram/client";
import { stripMarkdownForTelegram } from "@/lib/telegram/format";

const DEFAULT_MESSAGE =
  "Hi! Just following up — let us know if you have any questions or would like to book a trial lesson.";

/**
 * Sends every follow-up/reminder whose due_at has passed. Invoked by
 * Vercel Cron (see vercel.json's crons entry) on a schedule — Vercel signs
 * these requests with an Authorization: Bearer <CRON_SECRET> header when
 * CRON_SECRET is configured, which is verified below; this route is
 * useless to call without knowing that secret, so it's safe to expose
 * without further per-organization auth (it processes every organization
 * in one pass by design — see listDueFollowUps).
 *
 * Reuses the SAME sendTelegramMessage() the webhook route uses for AI
 * replies (same retry/backoff/per-chat throttle) — no separate send path
 * to keep correct.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("send-follow-ups: CRON_SECRET is not configured — refusing to run.");
    return NextResponse.json({ ok: false, error: "Not configured" }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const dueFollowUps = await listDueFollowUps(new Date().toISOString());

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const followUp of dueFollowUps) {
    if (followUp.telegramChatId === null) {
      // Customer has no Telegram chat id on record — nothing to send to.
      // Not a transient failure, mark failed so it isn't retried forever.
      await markFollowUpFailed(followUp.organizationId, followUp.id);
      skipped++;
      continue;
    }

    const result = await sendTelegramMessage({
      botToken: followUp.botToken,
      chatId: followUp.telegramChatId,
      text: stripMarkdownForTelegram(followUp.message?.trim() || DEFAULT_MESSAGE),
      businessConnectionId: followUp.businessConnectionId ?? undefined,
    });

    if (result.ok) {
      await markFollowUpSent(followUp.organizationId, followUp.id);
      sent++;
    } else {
      console.error(`send-follow-ups: failed to send follow-up ${followUp.id}: ${result.description}`);
      await markFollowUpFailed(followUp.organizationId, followUp.id);
      failed++;
    }
  }

  return NextResponse.json({ ok: true, processed: dueFollowUps.length, sent, failed, skipped });
}
