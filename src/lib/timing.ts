import "server-only";

/**
 * Minimal latency-diagnostic helper for the Telegram message path —
 * structured console.log lines, visible in Vercel Runtime Logs exactly
 * like the existing console.error calls throughout this codebase. Not a
 * metrics/APM integration (none is set up in this project) — deliberately
 * lightweight so it's safe to leave in permanently rather than a
 * temporary instrument-then-rip-out exercise, since production latency
 * is an ongoing concern, not a one-time diagnosis.
 *
 * Usage: const done = startTimer("supabase.getBusinessSettings"); ... await done();
 * or: await timed("supabase.getBusinessSettings", () => getBusinessSettings(orgId))
 */
export function startTimer(label: string) {
  const start = performance.now();
  return () => {
    const ms = Math.round(performance.now() - start);
    console.log(`[timing] ${label}: ${ms}ms`);
    return ms;
  };
}

export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const ms = Math.round(performance.now() - start);
    console.log(`[timing] ${label}: ${ms}ms`);
  }
}
