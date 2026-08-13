"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ConversationListItem } from "@/lib/services/conversations";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { formatRelativeTime } from "@/lib/format";

export function InboxLayout({
  initialConversations,
  totalCount,
  children,
}: {
  initialConversations: ConversationListItem[];
  totalCount: number;
  children: React.ReactNode;
}) {
  const [conversations] = useState(initialConversations);
  const pathname = usePathname();

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-0 overflow-hidden rounded-lg border border-border bg-surface sm:h-[calc(100vh-7rem)]">
      <div
        className={`w-full shrink-0 flex-col overflow-y-auto border-r border-border lg:flex lg:w-80 ${
          pathname === "/app/inbox" ? "flex" : "hidden"
        }`}
      >
        <div className="border-b border-border px-4 py-3">
          <h1 className="text-sm font-semibold text-foreground">
            Conversations <span className="text-muted">({totalCount})</span>
          </h1>
        </div>

        {conversations.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No conversations yet"
              description="Once customers message your Telegram bot, conversations will show up here."
            />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {conversations.map((conversation) => {
              const isActive = pathname === `/app/inbox/${conversation.id}`;
              return (
                <li key={conversation.id}>
                  <Link
                    href={`/app/inbox/${conversation.id}`}
                    className={`flex flex-col gap-1 px-4 py-3 transition-colors ${
                      isActive ? "bg-accent/10" : "hover:bg-surface-hover"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {conversation.customerName ?? "Unknown customer"}
                      </span>
                      {conversation.status === "needs_attention" && (
                        <span aria-label="Needs attention" className="h-2 w-2 shrink-0 rounded-full bg-danger" />
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone={conversation.mode === "human" ? "warning" : "accent"}>
                        {conversation.mode === "human" ? "Human" : "AI"}
                      </Badge>
                      <span className="text-xs text-muted">
                        {conversation.lastMessageAt ? formatRelativeTime(conversation.lastMessageAt) : ""}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={`min-w-0 flex-1 flex-col lg:flex ${pathname === "/app/inbox" ? "hidden" : "flex"}`}>
        {children}
      </div>
    </div>
  );
}
