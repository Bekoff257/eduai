import type { WorkingHours } from "@/lib/services/business-settings";

export interface BusinessHoursCheck {
  isOpen: boolean;
  /** Human-readable next-open hint for the current day, e.g. "9:00 AM" —
   * null if hours aren't configured for today or the business is open. */
  todayHours: { open: string; close: string } | null;
}

/**
 * Evaluates workingHours against "now" in the organization's own
 * timezone — not server time, since a business in Tashkent and one in
 * New York have different local business hours at the same instant.
 * Uses Intl.DateTimeFormat with the IANA timezone (business_settings.timezone)
 * rather than a date library (none is installed in this project — see
 * src/lib/format.ts's own comment on this).
 *
 * A day absent from workingHours (or the whole map empty/unset) is
 * treated as ALWAYS OPEN — see WorkingHours's own doc comment for why:
 * a business that never configures this shouldn't be unexpectedly gated.
 * Only an explicit { open: null } (or missing open/close) for a
 * configured day means closed.
 */
export function checkBusinessHours(workingHours: WorkingHours, timezone: string, now = new Date()): BusinessHoursCheck {
  const hasAnyConfiguredDay = Object.keys(workingHours).length > 0;
  if (!hasAnyConfiguredDay) {
    return { isOpen: true, todayHours: null };
  }

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    // Invalid/unrecognized timezone string — fail open rather than
    // incorrectly telling every customer the business is closed because
    // of a bad settings value.
    return { isOpen: true, todayHours: null };
  }

  const weekdayShort = parts.find((p) => p.type === "weekday")?.value;
  const hour = parts.find((p) => p.type === "hour")?.value;
  const minute = parts.find((p) => p.type === "minute")?.value;
  if (!weekdayShort || hour === undefined || minute === undefined) {
    return { isOpen: true, todayHours: null };
  }

  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayShort) as
    | 0
    | 1
    | 2
    | 3
    | 4
    | 5
    | 6
    | -1;
  if (dayIndex === -1) {
    return { isOpen: true, todayHours: null };
  }

  const todayConfig = workingHours[dayIndex];
  if (!todayConfig) {
    // This specific day isn't configured even though others are —
    // same "don't gate on missing config" reasoning as the top-level check.
    return { isOpen: true, todayHours: null };
  }

  if (!todayConfig.open || !todayConfig.close) {
    return { isOpen: false, todayHours: null };
  }

  const nowMinutes = Number(hour) * 60 + Number(minute);
  const openMinutes = toMinutes(todayConfig.open);
  const closeMinutes = toMinutes(todayConfig.close);
  if (openMinutes === null || closeMinutes === null) {
    return { isOpen: true, todayHours: null };
  }

  const isOpen = nowMinutes >= openMinutes && nowMinutes < closeMinutes;
  return { isOpen, todayHours: { open: todayConfig.open, close: todayConfig.close } };
}

function toMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}
