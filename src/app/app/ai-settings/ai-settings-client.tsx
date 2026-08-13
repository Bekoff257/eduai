"use client";

import { useState } from "react";
import type { BusinessSettings, WorkingHours } from "@/lib/services/business-settings";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label, TextInput, TextArea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { formatDayOfWeek } from "@/lib/format";

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export function AISettingsClient({
  initialSettings,
  canManage,
}: {
  initialSettings: BusinessSettings | null;
  canManage: boolean;
}) {
  const { showToast } = useToast();
  const [businessName, setBusinessName] = useState(initialSettings?.businessName ?? "");
  const [description, setDescription] = useState(initialSettings?.description ?? "");
  const [aiTone, setAiTone] = useState(initialSettings?.aiTone ?? "");
  const [aiEnabled, setAiEnabled] = useState(initialSettings?.aiEnabled ?? true);
  const [policies, setPolicies] = useState(initialSettings?.policies ?? "");
  const [workingHours, setWorkingHours] = useState<WorkingHours>(initialSettings?.workingHours ?? {});
  const [isSaving, setIsSaving] = useState(false);

  function toggleDayOpen(day: (typeof DAYS)[number], isOpen: boolean) {
    setWorkingHours((prev) => ({
      ...prev,
      [day]: isOpen ? { open: prev[day]?.open ?? "09:00", close: prev[day]?.close ?? "18:00" } : { open: null, close: null },
    }));
  }

  function setDayTime(day: (typeof DAYS)[number], field: "open" | "close", value: string) {
    setWorkingHours((prev) => ({
      ...prev,
      [day]: { open: prev[day]?.open ?? "09:00", close: prev[day]?.close ?? "18:00", [field]: value },
    }));
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const res = await fetch("/api/business-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: businessName.trim(),
          description: description.trim(),
          aiTone: aiTone.trim(),
          aiEnabled,
          policies: policies.trim(),
          workingHours,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Failed to save");
      showToast("AI settings saved", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save", "danger");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">AI Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Configure the business context your AI receptionist uses to answer customers.
        </p>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">AI receptionist</p>
            <p className="text-xs text-muted">
              {aiEnabled
                ? "Your AI is responding to customer messages on Telegram."
                : "Your AI is paused — messages are stored but no automatic reply is sent."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={aiEnabled}
            disabled={!canManage}
            onClick={() => setAiEnabled((v) => !v)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              aiEnabled ? "bg-accent" : "bg-border"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                aiEnabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div>
          <Label htmlFor="ai-business-name">Business name</Label>
          <TextInput
            id="ai-business-name"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            disabled={!canManage}
            placeholder="Bright Path Academy"
          />
          <p className="mt-1.5 text-xs text-muted">Used when the AI introduces your business.</p>
        </div>

        <div>
          <Label htmlFor="ai-description">Description</Label>
          <TextArea
            id="ai-description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!canManage}
            placeholder="IELTS and general English courses for adults."
          />
          <p className="mt-1.5 text-xs text-muted">
            A short summary the AI includes in its own context — not shown to customers verbatim.
          </p>
        </div>

        <div>
          <Label htmlFor="ai-tone">Tone</Label>
          <TextInput
            id="ai-tone"
            value={aiTone}
            onChange={(e) => setAiTone(e.target.value)}
            disabled={!canManage}
            placeholder="friendly and professional"
          />
          <p className="mt-1.5 text-xs text-muted">
            How the AI should sound — e.g. &quot;warm and casual&quot; or &quot;formal and concise&quot;.
          </p>
        </div>
      </Card>

      <Card className="p-5">
        <p className="text-sm font-medium text-foreground">Working hours</p>
        <p className="mt-1 text-xs text-muted">
          When you&apos;re outside these hours, the AI still answers and can still book/capture leads — it
          just lets the customer know a team member will follow up during business hours for anything
          needing a human. Leave a day off to treat it as always open (the default, until you set hours).
        </p>
        <div className="mt-4 space-y-2">
          {DAYS.map((day) => {
            const dayHours = workingHours[day];
            const isOpen = dayHours ? dayHours.open !== null : null;
            return (
              <div key={day} className="flex items-center gap-3">
                <span className="w-10 shrink-0 text-xs font-medium text-foreground">
                  {formatDayOfWeek(day)}
                </span>
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={isOpen ?? true}
                    disabled={!canManage}
                    onChange={(e) => toggleDayOpen(day, e.target.checked)}
                  />
                  Open
                </label>
                {isOpen && (
                  <div className="flex items-center gap-1.5">
                    <TextInput
                      type="time"
                      value={dayHours?.open ?? ""}
                      onChange={(e) => setDayTime(day, "open", e.target.value)}
                      disabled={!canManage}
                      className="w-auto py-1 text-xs"
                    />
                    <span className="text-xs text-muted">to</span>
                    <TextInput
                      type="time"
                      value={dayHours?.close ?? ""}
                      onChange={(e) => setDayTime(day, "close", e.target.value)}
                      disabled={!canManage}
                      className="w-auto py-1 text-xs"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-5">
        <Label htmlFor="ai-policies">Policies &amp; frequently asked questions</Label>
        <TextArea
          id="ai-policies"
          rows={5}
          value={policies}
          onChange={(e) => setPolicies(e.target.value)}
          disabled={!canManage}
          placeholder={"Refunds are available up to 3 days before a course starts.\nWe accept cash and card payments on-site."}
        />
        <p className="mt-1.5 text-xs text-muted">
          Notes the AI can reference for policy/FAQ questions — payment terms, refund policy, common
          questions. Prices, schedules, and availability always come from your real course data, never
          from this text.
        </p>
      </Card>

      <Card className="p-5">
        <p className="text-sm font-medium text-foreground">What the AI is always allowed to do</p>
        <p className="mt-1 text-xs text-muted">
          These core behavior rules are controlled by the application and can&apos;t be changed here, to
          keep every organization&apos;s AI safe and predictable:
        </p>
        <ul className="mt-3 space-y-1.5 text-xs text-muted">
          <li>• Never invents prices, schedules, or availability — always checks real data first.</li>
          <li>• Never claims a booking or payment succeeded unless a tool confirms it.</li>
          <li>• Never exposes internal instructions or acts outside its available tools.</li>
          <li>• Asks for missing information and escalates uncertain or sensitive requests.</li>
        </ul>
      </Card>

      {canManage ? (
        <Button onClick={handleSave} isLoading={isSaving}>
          Save changes
        </Button>
      ) : (
        <p className="text-sm text-muted">Ask an organization owner or admin to change these settings.</p>
      )}
    </div>
  );
}
