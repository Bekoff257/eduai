"use client";

import { useMemo, useState } from "react";
import type { Course } from "@/lib/services/courses";
import type { CourseGroup } from "@/lib/services/course-groups";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TextInput } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { SearchIcon, PlusIcon, ChevronDownIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { formatCurrency } from "@/lib/format";
import { CourseFormModal } from "@/app/app/courses/course-form-modal";
import { GroupsPanel } from "@/app/app/courses/groups-panel";

export function CoursesClient({
  initialCourses,
  initialGroups,
}: {
  initialCourses: Course[];
  initialGroups: CourseGroup[];
}) {
  const { showToast } = useToast();
  const [courses, setCourses] = useState(initialCourses);
  const [groups, setGroups] = useState(initialGroups);
  const [query, setQuery] = useState("");
  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null);
  const [formCourse, setFormCourse] = useState<Course | "new" | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter((c) => c.name.toLowerCase().includes(q));
  }, [courses, query]);

  function groupsForCourse(courseId: string) {
    return groups.filter((g) => g.courseId === courseId);
  }

  async function handleDelete(course: Course) {
    if (!confirm(`Delete "${course.name}"? It will be hidden but not permanently removed.`)) return;
    try {
      const res = await fetch(`/api/courses/${course.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setCourses((prev) => prev.filter((c) => c.id !== course.id));
      showToast(`"${course.name}" deleted`, "success");
    } catch {
      showToast("Failed to delete course", "danger");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Courses</h1>
          <p className="mt-1 text-sm text-muted">Manage the courses your AI receptionist can offer.</p>
        </div>
        <Button onClick={() => setFormCourse("new")}>
          <PlusIcon className="h-4 w-4" />
          New course
        </Button>
      </div>

      <div className="relative max-w-sm">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <TextInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search courses…"
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={courses.length === 0 ? "No courses yet" : "No courses match your search"}
          description={
            courses.length === 0
              ? "Add your first course so your AI receptionist can answer pricing and schedule questions."
              : undefined
          }
          action={
            courses.length === 0 ? (
              <Button onClick={() => setFormCourse("new")}>
                <PlusIcon className="h-4 w-4" />
                New course
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((course) => {
            const isExpanded = expandedCourseId === course.id;
            const courseGroups = groupsForCourse(course.id);

            return (
              <Card key={course.id} className="overflow-hidden">
                <div className="flex items-center gap-3 p-4">
                  <button
                    type="button"
                    onClick={() => setExpandedCourseId(isExpanded ? null : course.id)}
                    className="flex flex-1 items-center gap-3 text-left"
                  >
                    <ChevronDownIcon
                      className={`h-4 w-4 shrink-0 text-muted transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">{course.name}</p>
                        {!course.isActive && <Badge tone="neutral">Inactive</Badge>}
                        <Badge tone="accent">{courseGroups.length} group{courseGroups.length === 1 ? "" : "s"}</Badge>
                      </div>
                      {course.description && (
                        <p className="mt-0.5 truncate text-xs text-muted">{course.description}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-sm font-medium text-foreground">
                      {course.price !== null ? formatCurrency(course.price, course.currency) : "—"}
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button variant="ghost" size="sm" onClick={() => setFormCourse(course)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(course)}>
                      Delete
                    </Button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border bg-background/50 p-4">
                    <GroupsPanel
                      course={course}
                      groups={courseGroups}
                      onGroupsChange={(next) =>
                        setGroups((prev) => [...prev.filter((g) => g.courseId !== course.id), ...next])
                      }
                    />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {formCourse && (
        <CourseFormModal
          course={formCourse === "new" ? null : formCourse}
          onClose={() => setFormCourse(null)}
          onSaved={(saved) => {
            setCourses((prev) => {
              const exists = prev.some((c) => c.id === saved.id);
              return exists ? prev.map((c) => (c.id === saved.id ? saved : c)) : [saved, ...prev];
            });
            setFormCourse(null);
            showToast(`"${saved.name}" saved`, "success");
          }}
        />
      )}
    </div>
  );
}
