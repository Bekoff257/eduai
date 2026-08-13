import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export interface TelegramIntegration {
  id: string;
  organizationId: string;
  botToken: string;
  botUsername: string | null;
  webhookToken: string;
  webhookSecret: string;
  isActive: boolean;
  businessConnectionId: string | null;
  businessConnectionEnabled: boolean;
  businessOwnerUserId: number | null;
}

const FULL_COLUMNS =
  "id, organization_id, bot_token, bot_username, webhook_token, webhook_secret, is_active, business_connection_id, business_connection_enabled, business_owner_user_id";

function mapRow(row: {
  id: string;
  organization_id: string;
  bot_token: string;
  bot_username: string | null;
  webhook_token: string;
  webhook_secret: string;
  is_active: boolean;
  business_connection_id: string | null;
  business_connection_enabled: boolean;
  business_owner_user_id: number | null;
}): TelegramIntegration {
  return {
    id: row.id,
    organizationId: row.organization_id,
    botToken: row.bot_token,
    botUsername: row.bot_username,
    webhookToken: row.webhook_token,
    webhookSecret: row.webhook_secret,
    isActive: row.is_active,
    businessConnectionId: row.business_connection_id,
    businessConnectionEnabled: row.business_connection_enabled,
    businessOwnerUserId: row.business_owner_user_id,
  };
}

/** Safe-to-return-to-the-browser projection — never includes botToken or
 * webhookSecret. Use this type (not TelegramIntegration) for anything a
 * dashboard API route sends back in a response body. */
export interface TelegramIntegrationSummary {
  organizationId: string;
  botUsername: string | null;
  webhookToken: string;
  isActive: boolean;
  createdAt: string;
  businessConnected: boolean;
  businessOwnerName: string | null;
}

const SUMMARY_COLUMNS =
  "organization_id, bot_username, webhook_token, is_active, created_at, business_connection_id, business_connection_enabled, business_owner_name";

function mapSummaryRow(row: {
  organization_id: string;
  bot_username: string | null;
  webhook_token: string;
  is_active: boolean;
  created_at: string;
  business_connection_id: string | null;
  business_connection_enabled: boolean;
  business_owner_name: string | null;
}): TelegramIntegrationSummary {
  return {
    organizationId: row.organization_id,
    botUsername: row.bot_username,
    webhookToken: row.webhook_token,
    isActive: row.is_active,
    createdAt: row.created_at,
    businessConnected: row.business_connection_id !== null && row.business_connection_enabled,
    businessOwnerName: row.business_owner_name,
  };
}

/** For the dashboard's Telegram settings page — returns only fields safe
 * to show in the browser (never bot_token/webhook_secret). */
export async function getTelegramIntegrationSummary(
  organizationId: string
): Promise<TelegramIntegrationSummary | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("telegram_integrations")
    .select(SUMMARY_COLUMNS)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw new Error(`getTelegramIntegrationSummary failed: ${error.message}`);
  return data ? mapSummaryRow(data) : null;
}

/**
 * Used server-side only (never returned to the browser) when the
 * dashboard needs the full row — e.g. to call Telegram's setWebhook with
 * the real bot token during connect/reconnect.
 */
export async function getTelegramIntegrationByOrganizationId(
  organizationId: string
): Promise<TelegramIntegration | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("telegram_integrations")
    .select(FULL_COLUMNS)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw new Error(`getTelegramIntegrationByOrganizationId failed: ${error.message}`);
  return data ? mapRow(data) : null;
}

/**
 * Creates or replaces the organization's single Telegram integration
 * (table has a unique(organization_id) constraint — one bot per org).
 * webhookSecret must be generated server-side by the caller (crypto-random,
 * never client-supplied) before calling this. webhook_token is left to the
 * column's own gen_random_uuid() default on insert; on update (reconnect)
 * the existing webhook_token is preserved so an already-configured
 * Telegram webhook URL keeps working with the same token but a rotated
 * secret — callers that DO want a new token should delete and recreate.
 */
export async function upsertTelegramIntegration(
  organizationId: string,
  input: { botToken: string; botUsername: string | null; webhookSecret: string }
): Promise<TelegramIntegration> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("telegram_integrations")
    .upsert(
      {
        organization_id: organizationId,
        bot_token: input.botToken,
        bot_username: input.botUsername,
        webhook_secret: input.webhookSecret,
        is_active: true,
      },
      { onConflict: "organization_id" }
    )
    .select(FULL_COLUMNS)
    .single();

  if (error) throw new Error(`upsertTelegramIntegration failed: ${error.message}`);
  return mapRow(data);
}

/**
 * Deactivates the whole integration (bot + any business connection).
 * Clears business_connection_enabled too — even though the owner's own
 * Telegram-side disconnect is the authoritative way to revoke the
 * connection there, our side should stop treating it as live immediately
 * rather than waiting for a business_connection webhook update that may
 * never arrive (e.g. if the bot itself is what's being disabled).
 */
export async function setTelegramIntegrationActive(
  organizationId: string,
  isActive: boolean
): Promise<TelegramIntegrationSummary | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("telegram_integrations")
    .update({ is_active: isActive, business_connection_enabled: isActive ? undefined : false })
    .eq("organization_id", organizationId)
    .select(SUMMARY_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(`setTelegramIntegrationActive failed: ${error.message}`);
  return data ? mapSummaryRow(data) : null;
}

/**
 * The ONLY way an organization is resolved from an inbound Telegram
 * request that carries a webhook_token — via the opaque webhook_token path
 * segment, never anything in the Telegram update payload itself (chat/user
 * ids are per-bot, not globally unique, and are attacker-controlled
 * input). Callers must also verify the request's
 * X-Telegram-Bot-Api-Secret-Token header against the returned row's
 * webhookSecret before trusting this integration — this function alone
 * does not authenticate the request, it only looks up which organization a
 * webhook_token claims to belong to.
 */
export async function getTelegramIntegrationByWebhookToken(
  webhookToken: string
): Promise<TelegramIntegration | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("telegram_integrations")
    .select(FULL_COLUMNS)
    .eq("webhook_token", webhookToken)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw new Error(`getTelegramIntegrationByWebhookToken failed: ${error.message}`);
  return data ? mapRow(data) : null;
}

/**
 * The equivalent tenant-resolution lookup for a business_message update:
 * business_connection_id is Telegram-issued (assigned when the owner
 * connects the bot via their own Telegram Business -> Chatbots settings)
 * and unique per connection (see the partial unique index in
 * 20260813092027_telegram_business_connections.sql) — never
 * client/model-supplied, arrives only as a field on an authenticated
 * webhook payload (secret_token header still verified separately by the
 * caller, same as the webhook_token path).
 */
export async function getTelegramIntegrationByBusinessConnectionId(
  businessConnectionId: string
): Promise<TelegramIntegration | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("telegram_integrations")
    .select(FULL_COLUMNS)
    .eq("business_connection_id", businessConnectionId)
    .eq("business_connection_enabled", true)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw new Error(`getTelegramIntegrationByBusinessConnectionId failed: ${error.message}`);
  return data ? mapRow(data) : null;
}

/**
 * Records/updates the state of a business connection from a
 * business_connection webhook update. This is how business_connection_id
 * first gets attached to an organization's integration row — the owner
 * connects OUR bot (identified by botToken, hence lookup by bot_token
 * rather than by an id we don't have yet) via their own Telegram client,
 * and Telegram tells our webhook about it after the fact.
 *
 * A business_connection update also fires on disconnect/reconfigure
 * (is_enabled flips, or rights change) — this function is the single
 * place that keeps our copy of that state in sync, called on every such
 * update regardless of whether it's a new connection or a state change.
 */
export async function upsertBusinessConnection(
  botToken: string,
  input: {
    businessConnectionId: string;
    isEnabled: boolean;
    rights: Record<string, boolean>;
    ownerName: string | null;
    ownerUserId: number;
  }
): Promise<TelegramIntegration | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("telegram_integrations")
    .update({
      business_connection_id: input.businessConnectionId,
      business_connection_enabled: input.isEnabled,
      business_connection_rights: input.rights,
      business_owner_name: input.ownerName,
      business_owner_user_id: input.ownerUserId,
    })
    .eq("bot_token", botToken)
    .select(FULL_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(`upsertBusinessConnection failed: ${error.message}`);
  return data ? mapRow(data) : null;
}
