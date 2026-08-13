"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Conversation } from "@/lib/services/conversations";
import type { Customer } from "@/lib/services/customers";
import type { Message } from "@/lib/services/messages";
import type { HumanTakeover } from "@/lib/services/human-takeovers";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TextArea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";

const SENDER_LABEL: Record<Message["sender"], string> = {
  customer: "Customer",
  ai: "AI",
  staff: "Staff",
  system: "System",
};

function bubbleAlignment(sender: Message["sender"]) {
  return sender === "customer" ? "items-start" : "items-end";
}

function bubbleTone(sender: Message["sender"]) {
  switch (sender) {
    case "customer":
      return "bg-surface-hover text-foreground";
    case "ai":
      return "bg-accent/10 text-foreground";
    case "staff":
      return "bg-accent text-accent-foreground";
    case "system":
      return "bg-transparent text-muted italic";
  }
}

export function ConversationThread({
  conversation,
  customer,
  initialMessages,
  initialOpenTakeover,
}: {
  conversation: Conversation;
  customer: Customer | null;
  initialMessages: Message[];
  initialOpenTakeover: HumanTakeover | null;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [messages, setMessages] = useState(initialMessages);
  const [mode, setMode] = useState(conversation.mode);
  const [openTakeover, setOpenTakeover] = useState(initialOpenTakeover);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isTogglingTakeover, setIsTogglingTakeover] = useState(false);

  const canReply = customer?.telegramChatId != null;

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || isSending) return;

    setIsSending(true);
    try {
      const res = await fetch(`/api/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Failed to send message");

      setMessages((prev) => [...prev, json.message]);
      setDraft("");
      if (json.telegramWarning) {
        showToast(json.telegramWarning, "danger");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to send message", "danger");
    } finally {
      setIsSending(false);
    }
  }

  async function handleTakeoverToggle() {
    setIsTogglingTakeover(true);
    const action = mode === "human" ? "return_to_ai" : "take_over";
    try {
      const res = await fetch(`/api/conversations/${conversation.id}/takeover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Failed to update conversation");

      setMode(action === "take_over" ? "human" : "ai");
      setOpenTakeover(action === "take_over" ? json.takeover : null);
      showToast(action === "take_over" ? "You've taken over this conversation" : "Returned to AI", "success");
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update conversation", "danger");
    } finally {
      setIsTogglingTakeover(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {customer?.fullName ?? "Unknown customer"}
          </p>
          <p className="truncate text-xs text-muted">
            {customer?.telegramUsername ? `@${customer.telegramUsername}` : customer?.phone ?? "No contact info"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={mode === "human" ? "warning" : "accent"}>{mode === "human" ? "Human mode" : "AI mode"}</Badge>
          <Button
            size="sm"
            variant={mode === "human" ? "secondary" : "primary"}
            onClick={handleTakeoverToggle}
            isLoading={isTogglingTakeover}
          >
            {mode === "human" ? "Return to AI" : "Take over"}
          </Button>
        </div>
      </div>

      {openTakeover && (
        <div className="border-b border-border bg-warning/5 px-4 py-2 text-xs text-warning">
          A staff member is currently handling this conversation — the AI will not respond until it&apos;s returned.
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No messages yet.</p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={`flex flex-col gap-1 ${bubbleAlignment(message.sender)}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${bubbleTone(message.sender)}`}>
                {message.content}
              </div>
              <span className="px-1 text-[11px] text-muted">
                {SENDER_LABEL[message.sender]} &middot; {formatDateTime(message.createdAt)}
              </span>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSend} className="border-t border-border p-3">
        {!canReply && (
          <p className="mb-2 text-xs text-danger">
            This customer has no linked Telegram chat — replies can&apos;t be delivered.
          </p>
        )}
        <div className="flex items-end gap-2">
          <TextArea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend(e);
              }
            }}
            placeholder="Write a reply…"
            rows={2}
            disabled={!canReply}
            className="flex-1"
          />
          <Button type="submit" isLoading={isSending} disabled={!canReply || !draft.trim()}>
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}
