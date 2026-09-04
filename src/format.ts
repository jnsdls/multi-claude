// Relative time for `list`: reading ages and Window Resets.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A duration as `45s`, `3m`, `2h` or `5d`. Negative durations read as zero. */
export function formatDuration(ms: number): string {
  const t = Math.max(0, ms);
  if (t < MINUTE) return `${Math.floor(t / 1000)}s`;
  if (t < HOUR) return `${Math.floor(t / MINUTE)}m`;
  if (t < DAY) return `${Math.floor(t / HOUR)}h`;
  return `${Math.floor(t / DAY)}d`;
}

/** How long ago `iso` was, or `-` when it is null or unparseable. */
export function relativeAge(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "-";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "-";
  return formatDuration(now - t);
}

/** `in 2h` for a future instant, `now` once it has passed, `-` when unknown. */
export function relativeUntil(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "-";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "-";
  if (t <= now) return "now";
  return `in ${formatDuration(t - now)}`;
}
