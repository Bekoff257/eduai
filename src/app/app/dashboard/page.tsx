import Link from "next/link";
import { redirect } from "next/navigation";
import { getDashboardAuth } from "@/lib/dashboard/auth";
import { getDashboardStats } from "@/lib/dashboard/stats";
import { listConversations } from "@/lib/services/conversations";
import { listAppointments } from "@/lib/services/appointments";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { formatDateTime, formatRelativeTime } from "@/lib/format";

export default async function DashboardPage() {
  const auth = await getDashboardAuth();
  if (auth.status !== "authenticated" || auth.organization.status !== "single") {
    redirect("/login");
  }

  const { organization } = auth.organization;

  const [stats, recentConversations, upcomingAppointments] = await Promise.all([
    getDashboardStats(organization.id),
    listConversations(organization.id, { pageSize: 5 }),
    listAppointments(organization.id, {
      status: "scheduled",
      from: new Date().toISOString(),
      pageSize: 5,
    }),
  ]);

  const STAT_CARDS = [
    { label: "Total customers", value: stats.customers, href: "/app/customers" },
    { label: "New leads", value: stats.newLeads, href: "/app/leads" },
    { label: "Upcoming appointments", value: stats.upcomingAppointments, href: "/app/appointments" },
    { label: "Conversations", value: stats.conversations, href: "/app/inbox" },
    { label: "AI-handled conversations", value: stats.aiHandledConversations, href: "/app/inbox" },
    { label: "Needs human attention", value: stats.needsAttentionConversations, href: "/app/inbox" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Overview</h1>
        <p className="mt-1 text-sm text-muted">
          A snapshot of {organization.name}&apos;s AI receptionist activity.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {STAT_CARDS.map((card) => (
          <Link key={card.label} href={card.href}>
            <Card className="p-5 transition-colors hover:bg-surface-hover">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">{card.label}</p>
              <p className="mt-2 font-mono text-3xl font-semibold tabular-nums text-foreground">
                {card.value}
              </p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Recent conversations</h2>
            <Link href="/app/inbox" className="text-xs font-medium text-accent hover:opacity-80">
              View all
            </Link>
          </div>

          {recentConversations.conversations.length === 0 ? (
            <EmptyState
              title="No conversations yet"
              description="Once customers message your Telegram bot, conversations will show up here."
            />
          ) : (
            <ul className="divide-y divide-border">
              {recentConversations.conversations.map((conversation) => (
                <li key={conversation.id}>
                  <Link
                    href={`/app/inbox/${conversation.id}`}
                    className="flex items-center justify-between gap-3 py-3 hover:opacity-80"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {conversation.customerName ?? "Unknown customer"}
                      </p>
                      <p className="text-xs text-muted">
                        {conversation.lastMessageAt
                          ? formatRelativeTime(conversation.lastMessageAt)
                          : "No messages yet"}
                      </p>
                    </div>
                    <Badge tone={conversation.mode === "human" ? "warning" : "accent"}>
                      {conversation.mode === "human" ? "Human" : "AI"}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Upcoming appointments</h2>
            <Link href="/app/appointments" className="text-xs font-medium text-accent hover:opacity-80">
              View all
            </Link>
          </div>

          {upcomingAppointments.appointments.length === 0 ? (
            <EmptyState
              title="No upcoming appointments"
              description="Trial lessons and bookings your AI receptionist confirms will appear here."
            />
          ) : (
            <ul className="divide-y divide-border">
              {upcomingAppointments.appointments.map((appointment) => (
                <li key={appointment.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {appointment.customerName ?? "Unknown customer"}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {appointment.courseName} &middot; {appointment.courseGroupName}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted">
                    {formatDateTime(appointment.scheduledAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
