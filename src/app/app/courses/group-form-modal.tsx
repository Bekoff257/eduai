"use client";

import { useState } from "react";
import type { CourseGroup } from "@/lib/services/course-groups";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Label, TextInput, FieldError } from "@/components/ui/field";
import { formatDayOfWeek } from "@/lib/format";

const DAYS = [0, 1, 2, 3, 4, 5, 6];

export function GroupFormModal({
  courseId,
  group,
  onClose,
  onSaved,
}: {
  courseId: string;
  group: CourseGroup | null;
  onClose: () => void;
  onSaved: (group: CourseGroup) => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(group?.daysOfWeek ?? []);
  const [startTime, setStartTime] = useState(group?.startTime?.slice(0, 5) ?? "");
  const [endTime, setEndTime] = useState(group?.endTime?.slice(0, 5) ?? "");
  const [capacity, setCapacity] = useState(String(group?.capacity ?? 10));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggleDay(day: number) {
    setDaysOfWeek((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const capacityNum = Number(capacity);
    if (!Number.isInteger(capacityNum) || capacityNum < 0) {
      setError("Capacity must be a non-negative whole number");
      return;
    }

    setIsSubmitting(true);
    try {
      const body = {
        name: name.trim(),
        daysOfWeek,
        startTime: startTime || null,
        endTime: endTime || null,
        capacity: capacityNum,
      };

      const url = group
        ? `/api/courses/${courseId}/groups/${group.id}`
        : `/api/courses/${courseId}/groups`;
      const res = await fetch(url, {
        method: group ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Failed to save group");
      }
      onSaved(json.group);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save group");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={group ? "Edit group" : "New group"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="group-name">Name</Label>
          <TextInput
            id="group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mon/Wed/Fri 18:00"
            autoFocus
          />
        </div>

        <div>
          <Label>Days of week</Label>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((day) => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                aria-pressed={daysOfWeek.includes(day)}
                className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  daysOfWeek.includes(day)
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-foreground/80 hover:bg-surface-hover"
                }`}
              >
                {formatDayOfWeek(day)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="group-start">Start time</Label>
            <TextInput
              id="group-start"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="group-end">End time</Label>
            <TextInput
              id="group-end"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="group-capacity">Capacity</Label>
          <TextInput
            id="group-capacity"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            inputMode="numeric"
          />
        </div>

        <FieldError>{error}</FieldError>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={isSubmitting}>
            {group ? "Save changes" : "Create group"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
