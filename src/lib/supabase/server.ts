import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let serviceClient: SupabaseClient | null = null;

/**
 * Service-role Supabase client. Bypasses RLS entirely — this is now the
 * ONLY way anything in this app talks to Supabase (Telegram webhook,
 * background jobs, migrations/seeding, AND the dashboard). Identity is
 * Firebase Authentication, not Supabase Auth, so there is no Supabase
 * session for RLS to key off — authorization for every caller of this
 * client is enforced in application code instead:
 *
 *   - Telegram webhook: organization resolved from the verified
 *     telegram_integrations.webhook_token (src/lib/services/*).
 *   - Dashboard: organization resolved from a firebase-admin-VERIFIED
 *     Firebase ID token (src/lib/dashboard/auth.ts), never from anything
 *     the browser supplies directly.
 *
 * Every query issued through this client MUST be scoped by
 * organization_id explicitly by its caller — RLS provides no protection
 * here. See docs/architecture.md for the full auth model.
 */
export function getSupabaseServiceClient(): SupabaseClient {
  if (serviceClient) return serviceClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables"
    );
  }

  serviceClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return serviceClient;
}
