import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export type ConversationMode = "ai" | "human";
export type ConversationStatus = "open" | "closed" | "needs_attention";

export interface Conversation {
  id: string;
  organizationId: string;
  customerId: string;
  mode: ConversationMode;
  status: ConversationStatus;
  lastMessageAt: string | null;
  createdAt: string;
}

function mapRow(row: {
  id: string;
  organization_id: string;
  customer_id: string;
  mode: Conversation["mode"];
  status: Conversation["status"];
  last_message_at: string | null;
  created_at: string;
}): Conversation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    customerId: row.customer_id,
    mode: row.mode,
    status: row.status,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
  };
}

const SELECT_COLUMNS =
  "id, organization_id, customer_id, mode, status, last_message_at, created_at";

/**
 * Finds the customer's open conversation, or creates one. One open
 * conversation per customer is the MVP assumption (matches the master
 * spec — no multi-thread conversation UI yet).
 */
export async function findOrCreateOpenConversation(
  organizationId: string,
  customerId: string
): Promise<Conversation> {
  const supabase = getSupabaseServiceClient();

  const { data: existing, error: findError } = await supabase
    .from("conversations")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findError) throw new Error(`findOrCreateOpenConversation lookup failed: ${findError.message}`);
  if (existing) return mapRow(existing);

  const { data: created, error: insertError } = await supabase
    .from("conversations")
    .insert({ organization_id: organizationId, customer_id: customerId })
    .select(SELECT_COLUMNS)
    .single();

  if (insertError) throw new Error(`findOrCreateOpenConversation insert failed: ${insertError.message}`);
  return mapRow(created);
}

export async function getConversation(
  organizationId: string,
  conversationId: string
): Promise<Conversation | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("conversations")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", conversationId)
    .maybeSingle();

  if (error) throw new Error(`getConversation failed: ${error.message}`);
  return data ? mapRow(data) : null;
}

export interface ConversationListItem extends Conversation {
  customerName: string | null;
}

/** Lists conversations for the Inbox, newest activity first, joined with
 * the customer's display name (falls back to null — the page decides how
 * to render an unnamed customer). */
export async function listConversations(
  organizationId: string,
  options: { status?: ConversationStatus; page?: number; pageSize?: number } = {}
): Promise<{ conversations: ConversationListItem[]; totalCount: number }> {
  const supabase = getSupabaseServiceClient();
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let builder = supabase
    .from("conversations")
    .select(`${SELECT_COLUMNS}, customers(full_name, telegram_username)`, { count: "exact" })
    .eq("organization_id", organizationId);

  if (options.status) {
    builder = builder.eq("status", options.status);
  }

  const { data, error, count } = await builder
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw new Error(`listConversations failed: ${error.message}`);

  const conversations = (data ?? []).map((row) => {
    const customer = row.customers as unknown as
      | { full_name: string | null; telegram_username: string | null }
      | { full_name: string | null; telegram_username: string | null }[]
      | null;
    const c = Array.isArray(customer) ? customer[0] : customer;
    return {
      ...mapRow(row),
      customerName: c?.full_name ?? (c?.telegram_username ? `@${c.telegram_username}` : null),
    };
  });

  return { conversations, totalCount: count ?? 0 };
}

export async function listConversationsForCustomer(
  organizationId: string,
  customerId: string
): Promise<Conversation[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("conversations")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listConversationsForCustomer failed: ${error.message}`);
  return (data ?? []).map(mapRow);
}

export async function updateConversationMode(
  organizationId: string,
  conversationId: string,
  mode: ConversationMode
): Promise<Conversation | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("conversations")
    .update({ mode })
    .eq("organization_id", organizationId)
    .eq("id", conversationId)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(`updateConversationMode failed: ${error.message}`);
  return data ? mapRow(data) : null;
}

export async function updateConversationStatus(
  organizationId: string,
  conversationId: string,
  status: ConversationStatus
): Promise<Conversation | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("conversations")
    .update({ status })
    .eq("organization_id", organizationId)
    .eq("id", conversationId)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(`updateConversationStatus failed: ${error.message}`);
  return data ? mapRow(data) : null;
}

export async function touchConversationLastMessageAt(
  organizationId: string,
  conversationId: string
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("id", conversationId);

  if (error) throw new Error(`touchConversationLastMessageAt failed: ${error.message}`);
}
