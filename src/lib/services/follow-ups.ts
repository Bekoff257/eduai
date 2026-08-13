import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export type FollowUpStatus = "pending" | "sent" | "cancelled" | "failed";

export interface FollowUp {
  id: string;
  organizationId: string;
  leadId: string;
  customerId: string;
  status: FollowUpStatus;
  dueAt: string;
  message: string | null;
  sentAt: string | null;
  createdAt: string;
}

function mapRow(row: {
  id: string;
  organization_id: string;
  lead_id: string;
  customer_id: string;
  status: FollowUpStatus;
  due_at: string;
  message: string | null;
  sent_at: string | null;
  created_at: string;
}): FollowUp {
  return {
    id: row.id,
    organizationId: row.organization_id,
    leadId: row.lead_id,
    customerId: row.customer_id,
    status: row.status,
    dueAt: row.due_at,
    message: row.message,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

const SELECT_COLUMNS =
  "id, organization_id, lead_id, customer_id, status, due_at, message, sent_at, created_at";

/**
 * Schedules a follow-up (or reminder — same table/shape, distinguished
 * only by message content and due_at, per the existing schema; there is
 * no separate "reminder" table). leadId/customerId must both already be
 * verified to belong to organizationId by the caller — the DB trigger
 * assert_same_organization() additionally guards customer_id (not
 * lead_id) as defense in depth, same as every other tenant-owned table.
 */
export async function createFollowUp(
  organizationId: string,
  input: { leadId: string; customerId: string; dueAt: string; message?: string }
): Promise<FollowUp> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("follow_ups")
    .insert({
      organization_id: organizationId,
      lead_id: input.leadId,
      customer_id: input.customerId,
      due_at: input.dueAt,
      message: input.message ?? null,
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error) throw new Error(`createFollowUp failed: ${error.message}`);
  return mapRow(data);
}

export async function listFollowUpsForLead(organizationId: string, leadId: string): Promise<FollowUp[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("follow_ups")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .order("due_at", { ascending: true });

  if (error) throw new Error(`listFollowUpsForLead failed: ${error.message}`);
  return (data ?? []).map(mapRow);
}

export interface DueFollowUp extends FollowUp {
  telegramChatId: number | null;
  businessConnectionId: string | null;
  botToken: string;
}

/**
 * Cross-organization by design — this is the sender job's query (see
 * src/app/api/cron/send-follow-ups/route.ts), which must find every due
 * follow-up across every tenant in one pass, joined with exactly what's
 * needed to actually send it (the customer's Telegram identity and the
 * org's bot credentials). Never exposed to a dashboard/browser caller —
 * only the cron route (server-only, its own auth) calls this.
 *
 * follow_ups has no direct foreign key to telegram_integrations (both
 * only FK to organizations), so PostgREST's embedded-resource join syntax
 * can't express this in one request — done as two queries instead: fetch
 * due follow-ups + their customers' Telegram identity, then batch-fetch
 * the distinct organizations' integrations and join in application code.
 */
export async function listDueFollowUps(now: string, limit = 50): Promise<DueFollowUp[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("follow_ups")
    .select(`${SELECT_COLUMNS}, customers(telegram_chat_id)`)
    .eq("status", "pending")
    .lte("due_at", now)
    .order("due_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`listDueFollowUps failed: ${error.message}`);
  if (!data || data.length === 0) return [];

  const organizationIds = [...new Set(data.map((row) => row.organization_id))];
  const { data: integrations, error: integrationsError } = await supabase
    .from("telegram_integrations")
    .select("organization_id, bot_token, business_connection_id, business_connection_enabled, is_active")
    .in("organization_id", organizationIds)
    .eq("is_active", true);

  if (integrationsError) throw new Error(`listDueFollowUps failed: ${integrationsError.message}`);

  const integrationByOrg = new Map((integrations ?? []).map((i) => [i.organization_id, i]));

  type CustomerRef = { telegram_chat_id: number | null };

  return data
    .map((row) => {
      const integration = integrationByOrg.get(row.organization_id);
      if (!integration) return null;

      const customer = row.customers as unknown as CustomerRef | CustomerRef[] | null;
      const c = Array.isArray(customer) ? customer[0] : customer;

      return {
        ...mapRow(row),
        telegramChatId: c?.telegram_chat_id ?? null,
        businessConnectionId: integration.business_connection_enabled
          ? integration.business_connection_id
          : null,
        botToken: integration.bot_token,
      };
    })
    .filter((row): row is DueFollowUp => row !== null);
}

export async function markFollowUpSent(organizationId: string, followUpId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("follow_ups")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("id", followUpId);

  if (error) throw new Error(`markFollowUpSent failed: ${error.message}`);
}

export async function markFollowUpFailed(organizationId: string, followUpId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("follow_ups")
    .update({ status: "failed" })
    .eq("organization_id", organizationId)
    .eq("id", followUpId);

  if (error) throw new Error(`markFollowUpFailed failed: ${error.message}`);
}

export async function cancelFollowUp(organizationId: string, followUpId: string): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("follow_ups")
    .update({ status: "cancelled" })
    .eq("organization_id", organizationId)
    .eq("id", followUpId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`cancelFollowUp failed: ${error.message}`);
  return data !== null;
}
