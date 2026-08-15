"use client";

import { useState } from "react";
import type { Automation } from "@/lib/services/automations";
import type {
  AutomationTriggerType,
  AutomationCondition,
  ConditionField,
  ConditionOperator,
  AutomationActionStep,
  AutomationActionType,
  AutomationStopCondition,
} from "@/lib/automation/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Label, TextInput, TextArea, Select, FieldError } from "@/components/ui/field";
import {
  TRIGGER_LABELS,
  CONDITION_FIELD_LABELS,
  CONDITION_OPERATOR_LABELS,
  ACTION_TYPE_LABELS,
  STOP_CONDITION_LABELS,
} from "@/app/app/automations/labels";

const TRIGGER_TYPES = Object.keys(TRIGGER_LABELS) as AutomationTriggerType[];
const CONDITION_FIELDS = Object.keys(CONDITION_FIELD_LABELS) as ConditionField[];
const CONDITION_OPERATORS = Object.keys(CONDITION_OPERATOR_LABELS) as ConditionOperator[];
const ACTION_TYPES = Object.keys(ACTION_TYPE_LABELS) as AutomationActionType[];
const STOP_CONDITIONS = Object.keys(STOP_CONDITION_LABELS) as AutomationStopCondition[];
const LEAD_STATUSES = ["new", "contacted", "qualified", "appointment_booked", "converted", "lost"] as const;

function defaultActionForType(type: AutomationActionType): AutomationActionStep["action"] {
  switch (type) {
    case "send_message":
      return { type, message: "" };
    case "send_ai_message":
      return { type, instruction: "" };
    case "create_follow_up":
      return { type, message: "", dueInMinutes: 60 * 24 };
    case "update_lead":
      return { type, status: "contacted" };
    case "mark_conversation_needs_attention":
      return { type };
    case "notify_staff":
      return { type, message: "" };
  }
}

export function AutomationFormModal({
  automation,
  onClose,
  onSaved,
}: {
  automation: Automation | null;
  onClose: () => void;
  onSaved: (automation: Automation) => void;
}) {
  const [name, setName] = useState(automation?.name ?? "");
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>(automation?.triggerType ?? "lead_created");
  const [conditions, setConditions] = useState<AutomationCondition[]>(automation?.conditions ?? []);
  const [actions, setActions] = useState<AutomationActionStep[]>(
    automation?.actions ?? [{ action: { type: "send_ai_message", instruction: "" }, waitBeforeMinutes: 0 }]
  );
  const [stopConditions, setStopConditions] = useState<AutomationStopCondition[]>(
    automation?.stopConditions ?? ["customer_replied"]
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function addCondition() {
    setConditions((prev) => [...prev, { field: "lead_status", operator: "equals", value: "" }]);
  }
  function updateCondition(index: number, patch: Partial<AutomationCondition>) {
    setConditions((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }
  function removeCondition(index: number) {
    setConditions((prev) => prev.filter((_, i) => i !== index));
  }

  function addAction() {
    setActions((prev) => [...prev, { action: { type: "send_ai_message", instruction: "" }, waitBeforeMinutes: 60 }]);
  }
  function updateActionType(index: number, type: AutomationActionType) {
    setActions((prev) => prev.map((a, i) => (i === index ? { ...a, action: defaultActionForType(type) } : a)));
  }
  function updateActionField(index: number, patch: Record<string, unknown>) {
    setActions((prev) => prev.map((a, i) => (i === index ? { ...a, action: { ...a.action, ...patch } as AutomationActionStep["action"] } : a)));
  }
  function updateActionWait(index: number, waitBeforeMinutes: number) {
    setActions((prev) => prev.map((a, i) => (i === index ? { ...a, waitBeforeMinutes } : a)));
  }
  function removeAction(index: number) {
    setActions((prev) => prev.filter((_, i) => i !== index));
  }

  function toggleStopCondition(condition: AutomationStopCondition, checked: boolean) {
    setStopConditions((prev) => (checked ? [...prev, condition] : prev.filter((c) => c !== condition)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (name.trim().length === 0) {
      setError("Name is required");
      return;
    }
    if (actions.length === 0) {
      setError("At least one action is required");
      return;
    }

    setIsSubmitting(true);
    try {
      const body = { name: name.trim(), triggerType, conditions, actions, stopConditions };
      const res = await fetch(automation ? `/api/automations/${automation.id}` : "/api/automations", {
        method: automation ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Failed to save");
      onSaved(json.automation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={automation ? "Edit automation" : "New automation"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
        <div>
          <Label htmlFor="automation-name">Automation name</Label>
          <TextInput
            id="automation-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New Lead Follow-up"
            autoFocus
          />
        </div>

        <div>
          <Label htmlFor="automation-trigger">When</Label>
          <Select id="automation-trigger" value={triggerType} onChange={(e) => setTriggerType(e.target.value as AutomationTriggerType)}>
            {TRIGGER_TYPES.map((t) => (
              <option key={t} value={t}>
                {TRIGGER_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center justify-between">
            <Label className="mb-0">If (all must be true)</Label>
            <Button type="button" variant="ghost" size="sm" onClick={addCondition}>
              + Condition
            </Button>
          </div>
          {conditions.length === 0 && <p className="text-xs text-muted">No conditions — always runs on this trigger.</p>}
          {conditions.map((condition, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Select
                value={condition.field}
                onChange={(e) => updateCondition(i, { field: e.target.value as ConditionField })}
                className="w-auto"
              >
                {CONDITION_FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {CONDITION_FIELD_LABELS[f]}
                  </option>
                ))}
              </Select>
              {condition.field !== "business_hours" && (
                <>
                  <Select
                    value={condition.operator}
                    onChange={(e) => updateCondition(i, { operator: e.target.value as ConditionOperator })}
                    className="w-auto"
                  >
                    {CONDITION_OPERATORS.map((op) => (
                      <option key={op} value={op}>
                        {CONDITION_OPERATOR_LABELS[op]}
                      </option>
                    ))}
                  </Select>
                  <TextInput
                    value={typeof condition.value === "string" ? condition.value : (condition.value ?? []).join(",")}
                    onChange={(e) => updateCondition(i, { value: e.target.value })}
                    placeholder="value"
                    className="w-auto flex-1"
                  />
                </>
              )}
              <Button type="button" variant="ghost" size="sm" onClick={() => removeCondition(i)}>
                Remove
              </Button>
            </div>
          ))}
        </div>

        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="flex items-center justify-between">
            <Label className="mb-0">Then (in order)</Label>
            <Button type="button" variant="ghost" size="sm" onClick={addAction}>
              + Action
            </Button>
          </div>
          {actions.map((step, i) => (
            <div key={i} className="space-y-2 rounded-md bg-background/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <Select
                  value={step.action.type}
                  onChange={(e) => updateActionType(i, e.target.value as AutomationActionType)}
                  className="w-auto"
                >
                  {ACTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ACTION_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeAction(i)}>
                  Remove
                </Button>
              </div>

              {i > 0 && (
                <div className="flex items-center gap-2">
                  <Label htmlFor={`wait-${i}`} className="mb-0 shrink-0">
                    Wait
                  </Label>
                  <TextInput
                    id={`wait-${i}`}
                    type="number"
                    min={0}
                    value={step.waitBeforeMinutes}
                    onChange={(e) => updateActionWait(i, Number(e.target.value))}
                    className="w-24"
                  />
                  <span className="text-xs text-muted">minutes before this action</span>
                </div>
              )}

              {(step.action.type === "send_message" || step.action.type === "notify_staff") && (
                <TextArea
                  value={step.action.message}
                  onChange={(e) => updateActionField(i, { message: e.target.value })}
                  placeholder="Message text…"
                  rows={2}
                />
              )}
              {step.action.type === "send_ai_message" && (
                <TextArea
                  value={step.action.instruction ?? ""}
                  onChange={(e) => updateActionField(i, { instruction: e.target.value })}
                  placeholder="Optional instruction for the AI, e.g. 'Check in since they went quiet' — leave blank for a natural default check-in."
                  rows={2}
                />
              )}
              {step.action.type === "create_follow_up" && (
                <>
                  <TextArea
                    value={step.action.message ?? ""}
                    onChange={(e) => updateActionField(i, { message: e.target.value })}
                    placeholder="Follow-up message (optional)…"
                    rows={2}
                  />
                  <div className="flex items-center gap-2">
                    <Label className="mb-0 shrink-0">Due in</Label>
                    <TextInput
                      type="number"
                      min={0}
                      value={step.action.dueInMinutes}
                      onChange={(e) => updateActionField(i, { dueInMinutes: Number(e.target.value) })}
                      className="w-24"
                    />
                    <span className="text-xs text-muted">minutes from when this action runs</span>
                  </div>
                </>
              )}
              {step.action.type === "update_lead" && (
                <Select
                  value={step.action.status}
                  onChange={(e) => updateActionField(i, { status: e.target.value })}
                  className="w-auto"
                >
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Label>Stop when</Label>
          <div className="flex flex-wrap gap-4">
            {STOP_CONDITIONS.map((c) => (
              <label key={c} className="flex items-center gap-1.5 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={stopConditions.includes(c)}
                  onChange={(e) => toggleStopCondition(c, e.target.checked)}
                />
                {STOP_CONDITION_LABELS[c]}
              </label>
            ))}
          </div>
        </div>

        <FieldError>{error}</FieldError>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={isSubmitting}>
            {automation ? "Save changes" : "Create automation"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
