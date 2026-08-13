"use client";

import { useEffect, useState } from "react";
import type { TelegramIntegrationSummary } from "@/lib/services/telegram-integrations";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label, TextInput, FieldError } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";

/** While a bot is registered but not yet business-connected, poll for the
 * business_connection webhook update landing (the owner connecting it on
 * their end is an async, out-of-band action — there's no request/response
 * moment to react to otherwise). Stops once connected. */
const STATUS_POLL_MS = 5000;

export function TelegramClient({
  initialIntegration,
  canManage,
}: {
  initialIntegration: TelegramIntegrationSummary | null;
  canManage: boolean;
}) {
  const { showToast } = useToast();
  const [integration, setIntegration] = useState(initialIntegration);
  const [botToken, setBotToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const botRegistered = integration?.isActive ?? false;
  const businessConnected = integration?.businessConnected ?? false;

  useEffect(() => {
    if (!botRegistered || businessConnected) return;
    const id = setInterval(async () => {
      const res = await fetch("/api/telegram-integration");
      const json = await res.json();
      if (json.ok && json.integration) setIntegration(json.integration);
    }, STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [botRegistered, businessConnected]);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!botToken.trim()) {
      setError("Enter your bot token");
      return;
    }

    setIsConnecting(true);
    try {
      const res = await fetch("/api/telegram-integration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken: botToken.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Failed to connect bot");

      setIntegration(json.integration);
      setBotToken("");
      showToast("Bot registered — now connect it from your own Telegram app", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect bot");
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (
      !confirm(
        "Disconnect Telegram? Your AI receptionist will stop receiving messages from your personal Telegram account and from anyone messaging your bot directly."
      )
    ) {
      return;
    }
    setIsDisconnecting(true);
    try {
      const res = await fetch("/api/telegram-integration", { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Failed to disconnect");
      setIntegration(json.integration);
      showToast("Telegram disconnected", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to disconnect", "danger");
    } finally {
      setIsDisconnecting(false);
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Telegram</h1>
        <p className="mt-1 text-sm text-muted">
          Connect your AI receptionist to your own Telegram account — customers message YOU, and your AI
          replies through your real account. No separate bot for them to find or message.
        </p>
      </div>

      {/* Step 1: register the org's dedicated bot (backend plumbing — customers never see or message it directly). */}
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">
            1
          </span>
          <p className="text-sm font-semibold text-foreground">Set up your receptionist</p>
          {botRegistered && <Badge tone="success">Done</Badge>}
        </div>

        {botRegistered ? (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">
              Registered as {integration?.botUsername ? `@${integration.botUsername}` : "a bot"} on{" "}
              {integration && formatDateTime(integration.createdAt)}
            </p>
            {canManage && (
              <Button variant="ghost" size="sm" onClick={handleDisconnect} isLoading={isDisconnecting}>
                Disconnect
              </Button>
            )}
          </div>
        ) : canManage ? (
          <form onSubmit={handleConnect} className="space-y-4">
            <div>
              <Label htmlFor="bot-token">Bot token</Label>
              <TextInput
                id="bot-token"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="123456789:AA…"
                autoComplete="off"
              />
              <p className="mt-1.5 text-xs text-muted">
                Create a free bot with{" "}
                <a
                  href="https://t.me/BotFather"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  @BotFather
                </a>{" "}
                on Telegram and paste its token here. This is one-time setup — your customers will never
                message this bot directly.
              </p>
            </div>
            <FieldError>{error}</FieldError>
            <Button type="submit" isLoading={isConnecting}>
              Register bot
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted">Ask an organization owner or admin to set this up.</p>
        )}
      </Card>

      {/* Step 2: the owner connects that bot to their OWN account from their own Telegram app — nothing we can trigger from here, only observe. */}
      <Card className={`p-5 ${!botRegistered ? "opacity-50" : ""}`}>
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">
            2
          </span>
          <p className="text-sm font-semibold text-foreground">Connect it to your Telegram account</p>
          {businessConnected ? (
            <Badge tone="success">Connected</Badge>
          ) : botRegistered ? (
            <Badge tone="warning">Waiting</Badge>
          ) : null}
        </div>

        {!botRegistered ? (
          <p className="text-sm text-muted">Complete step 1 first.</p>
        ) : businessConnected ? (
          <p className="text-xs text-muted">
            Connected to {integration?.businessOwnerName ?? "your Telegram account"}. Customers who message
            you on Telegram are now answered by your AI, through your own account — they won&apos;t see any
            bot involved.
          </p>
        ) : (
          <div className="space-y-2 text-xs text-muted">
            <p>In your own Telegram app (not this dashboard):</p>
            <ol className="list-inside list-decimal space-y-1">
              <li>Open Settings → Telegram Business → Chatbots</li>
              <li>
                Add <span className="font-medium text-foreground">{integration?.botUsername ? `@${integration.botUsername}` : "your bot"}</span>
              </li>
              <li>Grant it permission to read and reply to messages</li>
            </ol>
            <p>This page updates automatically once you&apos;ve connected it — free, no Telegram Premium needed.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
