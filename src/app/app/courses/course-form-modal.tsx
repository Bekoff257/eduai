"use client";

import { useState } from "react";
import type { Course } from "@/lib/services/courses";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Label, TextInput, TextArea, FieldError, Select } from "@/components/ui/field";
import { COMMON_CURRENCIES } from "@/lib/currencies";

export function CourseFormModal({
  course,
  defaultCurrency,
  onClose,
  onSaved,
}: {
  course: Course | null;
  /** Org's business_settings.default_currency — pre-fills the currency
   * field for a NEW course only. Editing an existing course keeps that
   * course's own already-set currency untouched (never silently
   * overwritten by the org default). */
  defaultCurrency: string;
  onClose: () => void;
  onSaved: (course: Course) => void;
}) {
  const [name, setName] = useState(course?.name ?? "");
  const [description, setDescription] = useState(course?.description ?? "");
  const [price, setPrice] = useState(course?.price != null ? String(course.price) : "");
  const [currency, setCurrency] = useState(course?.currency ?? defaultCurrency);
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
        currency: currency.trim().toUpperCase() || defaultCurrency,
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
            <Select id="course-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {/* If this course already has a currency outside the common
                  shortlist (e.g. set before this dropdown existed, via the
                  old free-text field), show it as an extra option rather
                  than silently snapping the select to the first listed
                  currency on open — that would rewrite the course's
                  currency to something the owner never chose the moment
                  they opened "Edit", not just if they touch the field. */}
              {!COMMON_CURRENCIES.some((c) => c.code === currency) && (
                <option value={currency}>{currency}</option>
              )}
              {COMMON_CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </Select>
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
