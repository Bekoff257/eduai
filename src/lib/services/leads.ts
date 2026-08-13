import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export type LeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "appointment_booked"
  | "converted"
  | "lost";

export interface Lead {
  id: string;
  organizationId: string;
  customerId: string;
  courseId: string | null;
  source: string;
  status: LeadStatus;
  notes: string | null;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
}

function mapRow(row: {
  id: string;
  organization_id: string;
  customer_id: string;
  course_id: string | null;
  source: string;
  status: LeadStatus;
  notes: string | null;
  last_contacted_at: string | null;
  next_follow_up_at: string | null;
  created_at: string;
}): Lead {
  return {
    id: row.id,
    organizationId: row.organization_id,
    customerId: row.customer_id,
    courseId: row.course_id,
    source: row.source,
    status: row.status,
    notes: row.notes,
    lastContactedAt: row.last_contacted_at,
    nextFollowUpAt: row.next_follow_up_at,
    createdAt: row.created_at,
  };
}

const SELECT_COLUMNS =
  "id, organization_id, customer_id, course_id, source, status, notes, last_contacted_at, next_follow_up_at, created_at";

export async function createLead(
  organizationId: string,
  input: { customerId: string; courseId?: string; source?: string; notes?: string }
): Promise<Lead> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("leads")
    .insert({
      organization_id: organizationId,
      customer_id: input.customerId,
      course_id: input.courseId ?? null,
      source: input.source ?? "telegram",
      notes: input.notes ?? null,
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error) throw new Error(`createLead failed: ${error.message}`);
  return mapRow(data);
}

export async function updateLead(
  organizationId: string,
  leadId: string,
  input: { status?: LeadStatus; notes?: string; courseId?: string }
): Promise<Lead | null> {
  const supabase = getSupabaseServiceClient();
  const patch: Record<string, unknown> = {};
  if (input.status !== undefined) patch.status = input.status;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.courseId !== undefined) patch.course_id = input.courseId;

  const { data, error } = await supabase
    .from("leads")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("id", leadId)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(`updateLead failed: ${error.message}`);
  return data ? mapRow(data) : null;
}

/** Called when a follow-up/reminder is scheduled for this lead (see
 * src/lib/ai/tools/create-follow-up.ts) so the dashboard's existing leads
 * list — which already reads next_follow_up_at — reflects it without
 * needing a new page. Not part of updateLead's general patch shape since
 * this is a narrower, purpose-specific write. */
export async function setLeadNextFollowUpAt(
  organizationId: string,
  leadId: string,
  nextFollowUpAt: string
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("leads")
    .update({ next_follow_up_at: nextFollowUpAt })
    .eq("organization_id", organizationId)
    .eq("id", leadId);

  if (error) throw new Error(`setLeadNextFollowUpAt failed: ${error.message}`);
}

export async function getLead(organizationId: string, leadId: string): Promise<Lead | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("leads")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", leadId)
    .maybeSingle();

  if (error) throw new Error(`getLead failed: ${error.message}`);
  return data ? mapRow(data) : null;
}

export interface LeadListItem extends Lead {
  customerName: string | null;
  courseName: string | null;
}

export interface ListLeadsResult {
  leads: LeadListItem[];
  totalCount: number;
}

export async function listLeads(
  organizationId: string,
  options: { status?: LeadStatus; page?: number; pageSize?: number } = {}
): Promise<ListLeadsResult> {
  const supabase = getSupabaseServiceClient();
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let builder = supabase
    .from("leads")
    .select(`${SELECT_COLUMNS}, customers(full_name, telegram_username), courses(name)`, {
      count: "exact",
    })
    .eq("organization_id", organizationId);

  if (options.status) {
    builder = builder.eq("status", options.status);
  }

  const { data, error, count } = await builder
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw new Error(`listLeads failed: ${error.message}`);

  const leads = (data ?? []).map((row) => {
    type CustomerRef = { full_name: string | null; telegram_username: string | null };
    type CourseRef = { name: string };
    const customer = row.customers as unknown as CustomerRef | CustomerRef[] | null;
    const course = row.courses as unknown as CourseRef | CourseRef[] | null;
    const c = Array.isArray(customer) ? customer[0] : customer;
    const co = Array.isArray(course) ? course[0] : course;

    return {
      ...mapRow(row),
      customerName: c?.full_name ?? (c?.telegram_username ? `@${c.telegram_username}` : null),
      courseName: co?.name ?? null,
    };
  });

  return { leads, totalCount: count ?? 0 };
}

export async function listLeadsForCustomer(organizationId: string, customerId: string): Promise<Lead[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("leads")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listLeadsForCustomer failed: ${error.message}`);
  return (data ?? []).map(mapRow);
}

export async function findActiveLeadForCustomer(
  organizationId: string,
  customerId: string
): Promise<Lead | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("leads")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .not("status", "in", "(converted,lost)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`findActiveLeadForCustomer failed: ${error.message}`);
  return data ? mapRow(data) : null;
}
