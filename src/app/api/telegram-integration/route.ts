import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireOrgApiAuth, requireAdminRole } from "@/lib/dashboard/api-auth";
import {
  getTelegramIntegrationSummary,
  upsertTelegramIntegration,
  setTelegramIntegrationActive,
} from "@/lib/services/telegram-integrations";
import { getTelegramBotInfo, setTelegramWebhook } from "@/lib/telegram/client";

const connectSchema = z.object({
  botToken: z.string().trim().min(20, "That doesn't look like a valid bot token"),
});

/** Never returns bot_token or webhook_secret — see
 * TelegramIntegrationSummary's doc comment. Client-safe by construction. */
export async function GET() {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;

  const integration = await getTelegramIntegrationSummary(auth.organization.id);
  return NextResponse.json({ ok: true, integration });
}

/**
 * Step 1 of 2 in connecting Telegram: registers the organization's own
 * dedicated bot (each org needs one, so business connections don't
 * collide across tenants) and its webhook. This does NOT yet mean
 * customer DMs to the owner's personal account are handled — that only
 * starts once the owner separately connects this bot from THEIR OWN
 * Telegram app (Settings -> Telegram Business -> Chatbots, using the
 * @username shown after this step), which arrives asynchronously as a
 * business_connection webhook update (see the webhook route) and is
 * reflected in GET's businessConnected field once it happens. There is no
 * "step 2" endpoint here — step 2 happens entirely on Telegram's side, we
 * only observe its result.
 *
 * 1. Verify the token is real via Telegram's getMe (never trust it blindly).
 * 2. Generate a fresh, server-only random webhook secret — never
 *    client-supplied, matching every other secret in this codebase.
 * 3. Store the integration (service-role, admin-only — see
 *    requireAdminRole below).
 * 4. Register the webhook URL with Telegram using the real webhook_token
 *    this integration now has, so inbound messages start flowing
 *    immediately without a separate manual step.
 * Only ever returns the safe summary projection to the browser.
 */
export async function POST(request: NextRequest) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;

  const roleError = requireAdminRole(auth.organization);
  if (roleError) return roleError;

  const parsed = connectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const botInfo = await getTelegramBotInfo(parsed.data.botToken);
  if (!botInfo.ok) {
    return NextResponse.json(
      { ok: false, error: botInfo.description ?? "Telegram rejected this bot token" },
      { status: 400 }
    );
  }

  const webhookSecret = randomBytes(32).toString("hex");
  const integration = await upsertTelegramIntegration(auth.organization.id, {
    botToken: parsed.data.botToken,
    botUsername: botInfo.username,
    webhookSecret,
  });

  // Strip any trailing slash from NEXT_PUBLIC_APP_URL before appending a
  // path — a value like "https://example.com/" (trailing slash) would
  // otherwise produce a double slash ("https://example.com//api/...").
  // Telegram does not follow the 308 redirect Next.js issues to normalize
  // that, so every webhook delivery would fail with "Wrong response from
  // the webhook: 308 Permanent Redirect" and silently queue up undelivered.
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin).replace(/\/+$/, "");
  const webhookResult = await setTelegramWebhook({
    botToken: parsed.data.botToken,
    url: `${appUrl}/api/telegram/webhook/${integration.webhookToken}`,
    secretToken: webhookSecret,
  });

  if (!webhookResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `Bot connected but registering the webhook with Telegram failed: ${webhookResult.description ?? "unknown error"}`,
      },
      { status: 502 }
    );
  }

  const summary = await getTelegramIntegrationSummary(auth.organization.id);
  return NextResponse.json({ ok: true, integration: summary });
}

export async function DELETE() {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;

  const roleError = requireAdminRole(auth.organization);
  if (roleError) return roleError;

  const summary = await setTelegramIntegrationActive(auth.organization.id, false);
  return NextResponse.json({ ok: true, integration: summary });
}
