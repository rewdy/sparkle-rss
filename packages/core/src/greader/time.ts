const USEC_PER_MS = 1_000n;
const NSEC_PER_MS = 1_000_000n;
const MS_PER_SEC = 1_000n;

export function msToTimestampUsec(ms: number): string {
  return (BigInt(Math.round(ms)) * USEC_PER_MS).toString();
}

export function msToCrawlTimeMsec(ms: number): string {
  return Math.round(ms).toString();
}

export function dateToTimestampUsec(date: Date): string {
  return msToTimestampUsec(date.getTime());
}

export function dateToCrawlTimeMsec(date: Date): string {
  return msToCrawlTimeMsec(date.getTime());
}

export function secToDate(seconds: number): Date {
  return new Date(seconds * Number(MS_PER_SEC));
}

export function markAllAsReadTsToDate(nanoseconds: string | number): Date | null {
  const raw = typeof nanoseconds === 'number' ? nanoseconds.toString() : nanoseconds.trim();
  if (!/^\d{1,25}$/.test(raw)) return null;
  return new Date(Number(BigInt(raw) / NSEC_PER_MS));
}
