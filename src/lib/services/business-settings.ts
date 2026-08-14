import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

/** One entry per day of week actually configured (0=Sun..6=Sat, matching
 * course_groups.days_of_week's convention). A day absent from the map (or
 * an entirely empty/unset object) means "hours not configured" — treated
 * as always-open, not always-closed, so a business that never sets this
 * isn't unexpectedly gated. { open: null } for that day means CLOSED. */
export interface DayHours {
  open: string | null;
  close: string | null;
}
export type WorkingHours = Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, DayHours>>;

export interface BusinessSettings {
  organizationId: string;
  businessName: string;
  description: string;
  timezone: string;
  languages: string[];
  aiTone: string;
  aiEnabled: boolean;
  workingHours: WorkingHours;
  policies: string;
  /** Org-wide default currency (ISO 4217 code, e.g. "UZS", "USD"), set from
   * the dashboard. Pre-fills new courses in the dashboard course form only
   * — the AI must never substitute this for a specific course's own
   * courses.currency when quoting a price; that column is always the
   * source of truth for what currency a given course's price is in. */
  defaultCurrency: string;
}

function mapRow(row: {
  organization_id: string;
  business_name: string;
  description: string;
  timezone: string;
  languages: string[];
  ai_tone: string;
  ai_enabled: boolean;
  working_hours: unknown;
  policies: unknown;
  default_currency: string;
}): BusinessSettings {
  return {
    organizationId: row.organization_id,
    businessName: row.business_name,
    description: row.description,
    timezone: row.timezone,
    languages: row.languages ?? ["en"],
    aiTone: row.ai_tone,
    aiEnabled: row.ai_enabled,
    workingHours: isWorkingHours(row.working_hours) ? row.working_hours : {},
    policies: typeof row.policies === "string" ? row.policies : "",
    defaultCurrency: row.default_currency,
  };
}

/** policies is stored as jsonb but used here as a single free-text block
 * (FAQ/refund/payment policy notes an owner writes for the AI to draw on)
 * — a plain string column would have fit just as well, but the column is
 * already jsonb from the original schema, so a JSON string value is
 * stored rather than adding a migration to change its type for M4's
 * narrower "wire up existing plumbing" scope. */
function isWorkingHours(value: unknown): value is WorkingHours {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SELECT_COLUMNS =
  "organization_id, business_name, description, timezone, languages, ai_tone, ai_enabled, working_hours, policies, default_currency";

export async function getBusinessSettings(
  organizationId: string
): Promise<BusinessSettings | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("business_settings")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw new Error(`getBusinessSettings failed: ${error.message}`);
  return data ? mapRow(data) : null;
}

export interface UpdateBusinessSettingsInput {
  businessName?: string;
  description?: string;
  timezone?: string;
  languages?: string[];
  aiTone?: string;
  aiEnabled?: boolean;
  workingHours?: WorkingHours;
  policies?: string;
  defaultCurrency?: string;
}

/** business_settings has exactly one row per organization, created
 * atomically by create_organization_with_owner() — this always updates an
 * existing row, it never inserts. */
export async function updateBusinessSettings(
  organizationId: string,
  input: UpdateBusinessSettingsInput
): Promise<BusinessSettings | null> {
  const supabase = getSupabaseServiceClient();
  const patch: Record<string, unknown> = {};
  if (input.businessName !== undefined) patch.business_name = input.businessName;
  if (input.description !== undefined) patch.description = input.description;
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (input.languages !== undefined) patch.languages = input.languages;
  if (input.aiTone !== undefined) patch.ai_tone = input.aiTone;
  if (input.aiEnabled !== undefined) patch.ai_enabled = input.aiEnabled;
  if (input.workingHours !== undefined) patch.working_hours = input.workingHours;
  if (input.policies !== undefined) patch.policies = input.policies;
  if (input.defaultCurrency !== undefined) patch.default_currency = input.defaultCurrency;

  const { data, error } = await supabase
    .from("business_settings")
    .update(patch)
    .eq("organization_id", organizationId)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(`updateBusinessSettings failed: ${error.message}`);
  return data ? mapRow(data) : null;
}
