/**
 * Timezone-aware helpers for `YYYY-MM-DD` date strings.
 *
 * Why this module exists: `new Date().toISOString().slice(0, 10)` yields the
 * *UTC* date. A user in UTC-8 at 17:00 local time would get tomorrow's date,
 * causing tasks to be flagged overdue a full day early.
 *
 * All arithmetic below anchors dates at 12:00 UTC. Noon is far enough from
 * both midnights that adding/subtracting whole days can never be pushed into
 * the neighbouring day by a DST shift.
 */

import {
  asanaTimezone,
  businessDays as defaultBusinessDays,
} from "../config.js";

/** A half-open-free, inclusive date range. */
export interface DateRange {
  from: string;
  to: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/** Parse a `YYYY-MM-DD` string into a Date anchored at 12:00 UTC. */
function toDate(iso: string): Date {
  if (typeof iso !== "string" || !ISO_DATE_RE.test(iso)) {
    throw new Error(`Invalid ISO date "${iso}" — expected YYYY-MM-DD`);
  }
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO date "${iso}" — not a real calendar date`);
  }
  return date;
}

/** Render a noon-anchored Date back to `YYYY-MM-DD`. */
function formatISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Today's date as `YYYY-MM-DD` in the given IANA timezone.
 * Falls back to UTC (never throws) when the timezone string is not recognised.
 */
export function todayISO(tz: string = asanaTimezone): string {
  try {
    // The `en-CA` locale formats dates as YYYY-MM-DD natively.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Shift a date by a whole number of days (negative shifts backwards). */
export function addDaysISO(iso: string, days: number): string {
  const date = toDate(iso);
  date.setUTCDate(date.getUTCDate() + Math.trunc(days));
  return formatISO(date);
}

/** Whole days from `fromISO` to `toISO`. Negative when `toISO` precedes `fromISO`. */
export function diffDays(fromISO: string, toISO: string): number {
  const from = toDate(fromISO).getTime();
  const to = toDate(toISO).getTime();
  return Math.round((to - from) / MS_PER_DAY);
}

/** True when the date falls on one of `businessDays` (0 = Sunday … 6 = Saturday). */
export function isBusinessDay(
  iso: string,
  businessDays: number[] = defaultBusinessDays,
): boolean {
  return businessDays.includes(toDate(iso).getUTCDay());
}

/**
 * Count business days in the **inclusive** range `[fromISO, toISO]`.
 * Returns 0 when the range is inverted.
 */
export function businessDaysBetween(
  fromISO: string,
  toISO: string,
  businessDays: number[] = defaultBusinessDays,
): number {
  const span = diffDays(fromISO, toISO);
  if (span < 0) return 0;

  const cursor = toDate(fromISO);
  let count = 0;
  for (let i = 0; i <= span; i++) {
    if (businessDays.includes(cursor.getUTCDay())) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

/** Inclusive number of days covered by `[from, to]`. Zero when inverted. */
export function widthDays(from: string, to: string): number {
  const span = diffDays(from, to);
  return span < 0 ? 0 : span + 1;
}

/**
 * Split the inclusive range `[from, to]` into consecutive buckets of at most
 * `bucketDays` days. The final bucket may be shorter.
 * Returns an empty array when the range is inverted.
 */
export function splitRange(
  from: string,
  to: string,
  bucketDays: number,
): DateRange[] {
  const total = widthDays(from, to);
  if (total === 0) return [];

  const size = Math.max(1, Math.trunc(bucketDays) || 1);
  const buckets: DateRange[] = [];

  for (let offset = 0; offset < total; offset += size) {
    const bucketFrom = addDaysISO(from, offset);
    const lastOffset = Math.min(offset + size - 1, total - 1);
    buckets.push({ from: bucketFrom, to: addDaysISO(from, lastOffset) });
  }
  return buckets;
}

/**
 * Split a range into two contiguous halves.
 * Returns null when the range spans one day or less and cannot be divided.
 */
export function bisect(
  from: string,
  to: string,
): [DateRange, DateRange] | null {
  const total = widthDays(from, to);
  if (total <= 1) return null;

  const firstHalf = Math.floor(total / 2);
  return [
    { from, to: addDaysISO(from, firstHalf - 1) },
    { from: addDaysISO(from, firstHalf), to },
  ];
}

/**
 * Calendar-month buckets covering `[from, to]`, clipped to the range at both
 * edges. Returns an empty array when the range is inverted.
 */
export function startOfMonthsBetween(from: string, to: string): DateRange[] {
  if (widthDays(from, to) === 0) return [];

  const end = toDate(to);
  const buckets: DateRange[] = [];
  const cursor = toDate(from);

  while (cursor.getTime() <= end.getTime()) {
    // First day of the month after the cursor, then step back one day.
    const monthEnd = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1, 12, 0, 0),
    );
    monthEnd.setUTCDate(monthEnd.getUTCDate() - 1);

    const clippedEnd = monthEnd.getTime() > end.getTime() ? end : monthEnd;
    buckets.push({ from: formatISO(cursor), to: formatISO(clippedEnd) });

    // Jump to the first day of the next month.
    cursor.setUTCFullYear(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1);
  }
  return buckets;
}
