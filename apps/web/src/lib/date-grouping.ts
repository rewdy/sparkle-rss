const DAY_MS = 86_400_000;

function startOfToday(d = new Date()): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Coarse bucket label for an item's publish time, relative to today. */
export function dayGroup(ms: number, now = new Date()): string {
  const start = startOfToday(now);
  const d = new Date(ms);
  if (ms >= start) return "today";
  if (ms >= start - DAY_MS) return "yesterday";
  if (ms >= start - 7 * DAY_MS) return "this week";
  if (ms >= start - 30 * DAY_MS) return "this month";
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** Compact timestamp label: time-of-day for today, date otherwise. */
export function timeLabel(ms: number, now = new Date()): string {
  const d = new Date(ms);
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Flatten entries into contiguous date groups, preserving order. */
export function groupByDay<T extends { publishedAtMs: number }>(
  entries: T[],
  now = new Date(),
): Array<{ label: string; items: T[] }> {
  const groups: Array<{ label: string; items: T[] }> = [];
  for (const entry of entries) {
    const label = dayGroup(entry.publishedAtMs, now);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(entry);
    else groups.push({ label, items: [entry] });
  }
  return groups;
}
