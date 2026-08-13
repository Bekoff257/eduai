import { redirect, notFound } from "next/navigation";
import { getDashboardAuth } from "@/lib/dashboard/auth";
import { listConversations, getConversation } from "@/lib/services/conversations";
import { getCustomer } from "@/lib/services/customers";
import { listRecentMessages } from "@/lib/services/messages";
import { getOpenHumanTakeover } from "@/lib/services/human-takeovers";
import { InboxLayout } from "@/app/app/inbox/inbox-layout";
import { ConversationThread } from "@/app/app/inbox/[conversationId]/conversation-thread";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const auth = await getDashboardAuth();
  if (auth.status !== "authenticated" || auth.organization.status !== "single") {
    redirect("/login");
  }

  const { conversationId } = await params;
  const { organization } = auth.organization;

  const conversation = await getConversation(organization.id, conversationId);
  if (!conversation) {
    notFound();
  }

  const [listResult, customer, messages, openTakeover] = await Promise.all([
    listConversations(organization.id, { pageSize: 30 }),
    getCustomer(organization.id, conversation.customerId),
    listRecentMessages(organization.id, conversationId, 100),
    getOpenHumanTakeover(organization.id, conversationId),
  ]);

  return (
    <InboxLayout initialConversations={listResult.conversations} totalCount={listResult.totalCount}>
      <ConversationThread
        conversation={conversation}
        customer={customer}
        initialMessages={[...messages].reverse()}
        initialOpenTakeover={openTakeover}
      />
    </InboxLayout>
  );
}
