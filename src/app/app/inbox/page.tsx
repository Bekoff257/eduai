import { redirect } from "next/navigation";
import { getDashboardAuth } from "@/lib/dashboard/auth";
import { listConversations } from "@/lib/services/conversations";
import { InboxLayout } from "@/app/app/inbox/inbox-layout";
import { EmptyState } from "@/components/ui/states";

export default async function InboxPage() {
  const auth = await getDashboardAuth();
  if (auth.status !== "authenticated" || auth.organization.status !== "single") {
    redirect("/login");
  }

  const { organization } = auth.organization;
  const result = await listConversations(organization.id, { pageSize: 30 });

  return (
    <InboxLayout initialConversations={result.conversations} totalCount={result.totalCount}>
      <div className="hidden h-full items-center justify-center p-6 lg:flex">
        <EmptyState title="Select a conversation" description="Choose a conversation from the list to view the message thread." />
      </div>
    </InboxLayout>
  );
}
