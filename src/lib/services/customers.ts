import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { detectLanguage, detectExplicitLanguageRequest, type DetectableLanguage } from "@/lib/language-detect";
import type { BusinessSettings } from "@/lib/services/business-settings";

export type LanguageSource = "explicit" | "detected";

export interface Customer {
  id: string;
  organizationId: string;
  telegramChatId: number | null;
  telegramUsername: string | null;
  fullName: string | null;
  phone: string | null;
  language: string | null;
  /** Why `language` holds its current value — 'explicit' means the customer
   * directly asked for it (e.g. "Отвечайте на русском") and it must NEVER
   * be silently overwritten by auto-detection; 'detected' means it was
   * inferred from message text and CAN be updated by future detection.
   * Null means no language is known yet. See resolveCustomerLanguage. */
  languageSource: LanguageSource | null;
  notes: string | null;
}

function mapRow(row: {
  id: string;
  organization_id: string;
  telegram_chat_id: number | null;
  telegram_username: string | null;
  full_name: string | null;
  phone: string | null;
  language: string | null;
  language_source: string | null;
  notes: string | null;
}): Customer {
  return {
    id: row.id,
    organizationId: row.organization_id,
    telegramChatId: row.telegram_chat_id,
    telegramUsername: row.telegram_username,
    fullName: row.full_name,
    phone: row.phone,
    language: row.language,
    languageSource: row.language_source === "explicit" || row.language_source === "detected" ? row.language_source : null,
    notes: row.notes,
  };
}

const SELECT_COLUMNS =
  "id, organization_id, telegram_chat_id, telegram_username, full_name, phone, language, language_source, notes";

/**
 * Every function here takes organizationId as an explicit parameter and
 * includes it in every query. This is the sole authorization boundary for
 * this table when called via the service-role client (e.g. from the
 * Telegram webhook, which has no Supabase Auth session for RLS to key
 * off), so organizationId must always come from a trusted source (resolved
 * telegram_integrations row, never model/tool-call input).
 */
export async function findCustomerByTelegramChatId(
  organizationId: string,
  telegramChatId: number
): Promise<Customer | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("customers")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("telegram_chat_id", telegramChatId)
    .maybeSingle();

  if (error) throw new Error(`findCustomerByTelegramChatId failed: ${error.message}`);
  return data ? mapRow(data) : null;
}

export async function getCustomer(
  organizationId: string,
  customerId: string
): Promise<Customer | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("customers")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", customerId)
    .maybeSingle();

  if (error) throw new Error(`getCustomer failed: ${error.message}`);
  return data ? mapRow(data) : null;
}

export async function searchCustomers(
  organizationId: string,
  query: string,
  limit = 10
): Promise<Customer[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("customers")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .or(`full_name.ilike.%${query}%,telegram_username.ilike.%${query}%,phone.ilike.%${query}%`)
    .limit(limit);

  if (error) throw new Error(`searchCustomers failed: ${error.message}`);
  return (data ?? []).map(mapRow);
}

export interface ListCustomersResult {
  customers: Customer[];
  totalCount: number;
}

/** Paginated list for the dashboard's customer directory — unlike
 * searchCustomers (used by the AI agent, requires a query, capped small
 * limit), this supports browsing all customers with an optional search
 * term and returns a total count for pagination UI. */
export async function listCustomers(
  organizationId: string,
  options: { query?: string; page?: number; pageSize?: number } = {}
): Promise<ListCustomersResult> {
  const supabase = getSupabaseServiceClient();
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let builder = supabase
    .from("customers")
    .select(SELECT_COLUMNS, { count: "exact" })
    .eq("organization_id", organizationId);

  const query = options.query?.trim();
  if (query) {
    builder = builder.or(
      `full_name.ilike.%${query}%,telegram_username.ilike.%${query}%,phone.ilike.%${query}%`
    );
  }

  const { data, error, count } = await builder
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw new Error(`listCustomers failed: ${error.message}`);
  return { customers: (data ?? []).map(mapRow), totalCount: count ?? 0 };
}

export interface UpdateCustomerInput {
  fullName?: string | null;
  phone?: string | null;
  language?: string | null;
  /** Must be provided together with `language` whenever `language` is set
   * — there is no sensible default source for a language value someone is
   * actively writing. Omit both together to leave language untouched. */
  languageSource?: LanguageSource | null;
  notes?: string | null;
}

export async function updateCustomer(
  organizationId: string,
  customerId: string,
  input: UpdateCustomerInput
): Promise<Customer | null> {
  const supabase = getSupabaseServiceClient();
  const patch: Record<string, unknown> = {};
  if (input.fullName !== undefined) patch.full_name = input.fullName;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.language !== undefined) patch.language = input.language;
  if (input.languageSource !== undefined) patch.language_source = input.languageSource;
  if (input.notes !== undefined) patch.notes = input.notes;

  const { data, error } = await supabase
    .from("customers")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("id", customerId)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(`updateCustomer failed: ${error.message}`);
  return data ? mapRow(data) : null;
}

export async function createCustomer(
  organizationId: string,
  input: {
    telegramChatId?: number;
    telegramUsername?: string;
    fullName?: string;
    phone?: string;
    language?: string;
    languageSource?: LanguageSource;
  }
): Promise<Customer> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("customers")
    .insert({
      organization_id: organizationId,
      telegram_chat_id: input.telegramChatId ?? null,
      telegram_username: input.telegramUsername ?? null,
      full_name: input.fullName ?? null,
      phone: input.phone ?? null,
      language: input.language ?? null,
      // A language value with no source recorded defaults to 'detected'
      // (never 'explicit') — this tool-facing creation path has no
      // reliable signal that the customer explicitly requested this
      // language, so it must not be treated as permanently locked in.
      language_source: input.language ? (input.languageSource ?? "detected") : null,
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error) throw new Error(`createCustomer failed: ${error.message}`);
  return mapRow(data);
}

/**
 * Idempotent upsert keyed on (organization_id, telegram_chat_id) — the
 * table's existing unique constraint. Used by the webhook to resolve a
 * customer from an inbound Telegram message without a race between
 * concurrent updates for the same chat creating duplicate customers.
 *
 * On conflict this OVERWRITES telegram_username/full_name with whatever
 * Telegram just sent (Postgres ON CONFLICT DO UPDATE SET, not a merge) —
 * intentional, since Telegram includes these on every message and this
 * keeps the customer record in sync with the customer's current Telegram
 * profile. Do not pass undefined/omit a field expecting the old value to
 * be preserved; it will be overwritten with null instead.
 */
export async function upsertCustomerFromTelegram(
  organizationId: string,
  input: { telegramChatId: number; telegramUsername?: string; fullName?: string }
): Promise<Customer> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("customers")
    .upsert(
      {
        organization_id: organizationId,
        telegram_chat_id: input.telegramChatId,
        telegram_username: input.telegramUsername ?? null,
        full_name: input.fullName ?? null,
      },
      { onConflict: "organization_id,telegram_chat_id", ignoreDuplicates: false }
    )
    .select(SELECT_COLUMNS)
    .single();

  if (error) throw new Error(`upsertCustomerFromTelegram failed: ${error.message}`);
  return mapRow(data);
}

export interface ResolvedLanguage {
  language: string;
  source: LanguageSource;
  /** True when this differs from the customer's currently stored
   * language/languageSource and the caller should persist it. False means
   * "use this value, but there's nothing new to write" (e.g. an explicit
   * preference that's simply being reused as-is). */
  changed: boolean;
}

/**
 * The single source of truth for M5's language precedence rules — pure
 * function, no I/O, so it's directly unit-testable. Given the customer's
 * currently stored language state and this message's text, decides what
 * language to respond in AND whether anything needs to be persisted.
 *
 * Precedence (highest to lowest):
 *  1. This message is an EXPLICIT language request (detectExplicitLanguageRequest)
 *     — always wins, always persisted as 'explicit', regardless of what was
 *     stored before. This is the one case allowed to overwrite an existing
 *     'explicit' preference (a customer changing their mind again).
 *  2. The customer already has an 'explicit' preference stored — kept
 *     as-is. Auto-detection is NOT allowed to override it, even if this
 *     message's script/wording looks like a different language (e.g. the
 *     customer briefly typing a course name in English mid-Russian-
 *     conversation must not flip their preference back to English).
 *  3. This message's language is confidently auto-detected
 *     (detectLanguage) AND is in the business's supported-languages list
 *     — used, persisted as 'detected'.
 *  4. Detection was ambiguous/unsupported, but the customer has a prior
 *     'detected' language on record — kept as-is, so one ambiguous message
 *     ("IELTS?", "ok", a phone number) never resets a known preference.
 *  5. Nothing known at all — falls back to the organization's configured
 *     default_language, persisted as 'detected' (it's a system default,
 *     not something the customer stated).
 */
export function resolveCustomerLanguage(
  customer: Pick<Customer, "language" | "languageSource">,
  messageText: string,
  businessSettings: Pick<BusinessSettings, "languages" | "defaultLanguage"> | null
): ResolvedLanguage {
  const supportedLanguages = businessSettings?.languages ?? ["en"];
  const defaultLanguage = businessSettings?.defaultLanguage ?? "en";

  const explicitRequest = detectExplicitLanguageRequest(messageText);
  if (explicitRequest) {
    const changed = customer.language !== explicitRequest || customer.languageSource !== "explicit";
    return { language: explicitRequest, source: "explicit", changed };
  }

  if (customer.languageSource === "explicit" && customer.language) {
    return { language: customer.language, source: "explicit", changed: false };
  }

  const detected = detectLanguage(messageText);
  if (detected && isSupported(detected, supportedLanguages)) {
    const changed = customer.language !== detected || customer.languageSource !== "detected";
    return { language: detected, source: "detected", changed };
  }

  if (customer.language) {
    // Ambiguous/unsupported detection this time, but something was already
    // known (whatever its source) — keep it rather than resetting.
    return { language: customer.language, source: customer.languageSource ?? "detected", changed: false };
  }

  const changed = customer.language !== defaultLanguage || customer.languageSource !== "detected";
  return { language: defaultLanguage, source: "detected", changed };
}

function isSupported(language: DetectableLanguage, supportedLanguages: string[]): boolean {
  return supportedLanguages.some((l) => l.toLowerCase() === language.toLowerCase());
}
