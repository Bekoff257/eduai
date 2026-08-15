import { NextRequest, NextResponse } from "next/server";
import { runDueAutomationSteps } from "@/lib/automation/engine";

/**
 * Executes every currently-due automation_run_steps row across all
 * organizations. Same CRON_SECRET bearer-auth pattern as
 * /api/cron/send-follow-ups (see that route's own comment for the full
 * reasoning) — Vercel signs cron-triggered requests with this header
 * automatically, so this route is useless to call without knowing the
 * secret and is safe to expose without further per-organization auth
 * despite processing every organization in one pass by design (see
 * claimDueAutomationSteps in services/automations.ts).
 *
 * Safe under duplicate/overlapping invocations: runDueAutomationSteps()
 * claims steps via a single atomic UPDATE...RETURNING (see
 * claimDueAutomationSteps's own doc comment), so two overlapping cron
 * runs can never both execute the same step.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("run-automations: CRON_SECRET is not configured — refusing to run.");
    return NextResponse.json({ ok: false, error: "Not configured" }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const result = await runDueAutomationSteps();
  return NextResponse.json({ ok: true, ...result });
}
