import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export interface DashboardStats {
  conversations: number;
  customers: number;
  leads: number;
  appointments: number;
  aiHandledConversations: number;
  needsAttentionConversations: number;
  newLeads: number;
  upcomingAppointments: number;
}

/**
 * Real counts, scoped to organizationId — using the service-role client,
 * which bypasses RLS entirely. Unlike the earlier Supabase-Auth-session
 * design (where RLS was the actual gate and organizationId was "just" a
 * query-shaping convenience), organizationId here IS the real
 * authorization boundary for this query: nothing else stops it from
 * reading a different organization's counts.
 *
 * This is why every caller of getDashboardStats() MUST pass an
 * organizationId that came from resolveOrganization(firebaseUid)
 * (src/lib/dashboard/organizations.ts) with firebaseUid itself sourced
 * from a real verifyFirebaseIdToken() call — never an id read from a
 * request param, form field, or any other browser-controlled input. See
 * src/lib/dashboard/auth.ts, which is the only place in this codebase
 * that's allowed to produce an organizationId for dashboard use.
 */
export async function getDashboardStats(organizationId: string): Promise<DashboardStats> {
  const supabase = getSupabaseServiceClient();
  const nowIso = new Date().toISOString();

  const [
    conversations,
    customers,
    leads,
    appointments,
    aiHandledConversations,
    needsAttentionConversations,
    newLeads,
    upcomingAppointments,
  ] = await Promise.all([
    supabase.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "scheduled"),
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("mode", "ai"),
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "needs_attention"),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "new"),
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "scheduled")
      .gte("scheduled_at", nowIso),
  ]);

  for (const result of [
    conversations,
    customers,
    leads,
    appointments,
    aiHandledConversations,
    needsAttentionConversations,
    newLeads,
    upcomingAppointments,
  ]) {
    if (result.error) {
      throw new Error(`getDashboardStats failed: ${result.error.message}`);
    }
  }

  return {
    conversations: conversations.count ?? 0,
    customers: customers.count ?? 0,
    leads: leads.count ?? 0,
    appointments: appointments.count ?? 0,
    aiHandledConversations: aiHandledConversations.count ?? 0,
    needsAttentionConversations: needsAttentionConversations.count ?? 0,
    newLeads: newLeads.count ?? 0,
    upcomingAppointments: upcomingAppointments.count ?? 0,
  };
}
