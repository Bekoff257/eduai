"use client";

import { useState } from "react";
import type { Course } from "@/lib/services/courses";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Label, TextInput, TextArea, FieldError } from "@/components/ui/field";

export function CourseFormModal({
  course,
  onClose,
  onSaved,
}: {
  course: Course | null;
  onClose: () => void;
  onSaved: (course: Course) => void;
}) {
  const [name, setName] = useState(course?.name ?? "");
  const [description, setDescription] = useState(course?.description ?? "");
  const [price, setPrice] = useState(course?.price != null ? String(course.price) : "");
  const [currency, setCurrency] = useState(course?.currency ?? "USD");
  const [duration, setDuration] = useState(course?.duration ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (name.trim().length === 0) {
      setError("Name is required");
      return;
    }
    if (price.trim() && Number.isNaN(Number(price))) {
      setError("Price must be a number");
      return;
    }

    setIsSubmitting(true);
    try {
      const body = {
        name: name.trim(),
        description: description.trim(),
        price: price.trim() ? Number(price) : null,
        currency: currency.trim().toUpperCase() || "USD",
        duration: duration.trim() ? duration.trim() : null,
      };

      const res = await fetch(course ? `/api/courses/${course.id}` : "/api/courses", {
        method: course ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Failed to save course");
      }
      onSaved(json.course);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save course");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={course ? "Edit course" : "New course"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="course-name">Name</Label>
          <TextInput
            id="course-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="IELTS Preparation"
            autoFocus
          />
        </div>

        <div>
          <Label htmlFor="course-description">Description</Label>
          <TextArea
            id="course-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this course covers…"
            rows={3}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="course-price">Price</Label>
            <TextInput
              id="course-price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="450000"
              inputMode="decimal"
            />
          </div>
          <div>
            <Label htmlFor="course-currency">Currency</Label>
            <TextInput
              id="course-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              placeholder="USD"
              maxLength={3}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="course-duration">Duration</Label>
          <TextInput
            id="course-duration"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="3 months"
            maxLength={100}
          />
        </div>

        <FieldError>{error}</FieldError>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={isSubmitting}>
            {course ? "Save changes" : "Create course"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
