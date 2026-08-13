"use client";

import { useState } from "react";
import type { Course } from "@/lib/services/courses";
import type { CourseGroup } from "@/lib/services/course-groups";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { formatDayOfWeek, formatTimeOfDay } from "@/lib/format";
import { PlusIcon } from "@/components/ui/icons";
import { GroupFormModal } from "@/app/app/courses/group-form-modal";

export function GroupsPanel({
  course,
  groups,
  onGroupsChange,
}: {
  course: Course;
  groups: CourseGroup[];
  onGroupsChange: (groups: CourseGroup[]) => void;
}) {
  const { showToast } = useToast();
  const [formGroup, setFormGroup] = useState<CourseGroup | "new" | null>(null);

  function upsert(saved: CourseGroup) {
    const exists = groups.some((g) => g.id === saved.id);
    onGroupsChange(exists ? groups.map((g) => (g.id === saved.id ? saved : g)) : [...groups, saved]);
  }

  async function handleDelete(group: CourseGroup) {
    if (!confirm(`Delete "${group.name || "this group"}"? It will be hidden but not permanently removed.`)) return;
    try {
      const res = await fetch(`/api/courses/${course.id}/groups/${group.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      onGroupsChange(groups.filter((g) => g.id !== group.id));
      showToast("Group deleted", "success");
    } catch {
      showToast("Failed to delete group", "danger");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Groups &amp; schedule</h3>
        <Button size="sm" variant="secondary" onClick={() => setFormGroup("new")}>
          <PlusIcon className="h-3.5 w-3.5" />
          New group
        </Button>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-muted">
          No groups yet — add one to set capacity and a weekly schedule for this course.
        </p>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => (
            <div
              key={group.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{group.name || "Untitled group"}</p>
                  {!group.isActive && <Badge tone="neutral">Inactive</Badge>}
                </div>
                <p className="text-xs text-muted">
                  {group.daysOfWeek.length > 0
                    ? group.daysOfWeek.map(formatDayOfWeek).join(", ")
                    : "No days set"}
                  {group.startTime && ` · ${formatTimeOfDay(group.startTime)}–${formatTimeOfDay(group.endTime)}`}
                  {" · "}
                  Capacity {group.capacity}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => setFormGroup(group)}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(group)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {formGroup && (
        <GroupFormModal
          courseId={course.id}
          group={formGroup === "new" ? null : formGroup}
          onClose={() => setFormGroup(null)}
          onSaved={(saved) => {
            upsert(saved);
            setFormGroup(null);
            showToast("Group saved", "success");
          }}
        />
      )}
    </div>
  );
}
