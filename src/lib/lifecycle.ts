/**
 * Task lifecycle computation.
 *
 * Turns a normalized TaskEvent stream (see ./story-parser.ts) into a contiguous
 * section timeline plus derived flow metrics (cycle time, lead time, slip,
 * ownership churn). Pure data transformation: no API calls, no Asana client.
 *
 * DAY-COUNTING CONVENTION
 * -----------------------
 * All `days` fields are CALENDAR days measured between the two timestamps and
 * rounded to 1 decimal place (e.g. 2.5 = 60 hours). This keeps short-lived
 * sections from collapsing to 0 while staying human-readable. Negative spans
 * (possible when Asana returns slightly out-of-order timestamps) are clamped
 * to 0. The `businessDays` fields instead delegate to businessDaysBetween from
 * ./dates.js, which works on whole calendar dates.
 */

import { businessDaysBetween, diffDays } from "./dates.js";
import type { TaskEvent } from "./story-parser.js";
import { participantsFrom } from "./story-parser.js";

export type SectionInterval = {
  section: string;
  enteredAt: string;
  /** null = the task is still in this section. */
  exitedAt: string | null;
  days: number;
  businessDays: number;
};

export type Lifecycle = {
  createdAt: string | null;
  completedAt: string | null;
  firstActivityAt: string | null;
  lastActivityAt: string | null;
  sectionIntervals: SectionInterval[];
  sectionTotals: Record<
    string,
    { days: number; businessDays: number; visits: number }
  >;
  rescheduleCount: number;
  reschedulePattern: {
    from: string | null;
    to: string | null;
    at: string;
    slipDays: number | null;
  }[];
  reassignmentCount: number;
  /** Distinct assignees, ordered by first assignment. */
  assignees: string[];
  /** Calendar days since lastActivityAt, relative to `now`. */
  idleDays: number;
  /** First work start -> completedAt. null when the task is not complete. */
  cycleTimeDays: number | null;
  /** createdAt -> completedAt. null when the task is not complete. */
  leadTimeDays: number | null;
  commentCount: number;
  participants: { gid: string; name: string; eventCount: number }[];
};

const MS_PER_DAY = 86_400_000;
const UNKNOWN_SECTION = "Unknown";

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Calendar days between two timestamps, clamped at 0 and rounded to 1 dp. */
function daysBetween(fromISO: string | null, toISO: string | null): number {
  const a = ms(fromISO);
  const b = ms(toISO);
  if (a === null || b === null) return 0;
  const raw = (b - a) / MS_PER_DAY;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.round(raw * 10) / 10;
}

/** Date-only portion of an ISO timestamp, which is what dates.js works on. */
function dateOnly(iso: string): string {
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

/**
 * businessDaysBetween lives in a separately-owned module; guard against it
 * throwing on odd input so lifecycle computation can never blow up.
 */
function bizDays(
  fromISO: string | null,
  toISO: string | null,
  businessDays?: number[],
): number {
  if (!fromISO || !toISO) return 0;
  const a = ms(fromISO);
  const b = ms(toISO);
  if (a === null || b === null || b <= a) return 0;
  try {
    const result = businessDaysBetween(
      dateOnly(fromISO),
      dateOnly(toISO),
      businessDays,
    );
    return typeof result === "number" && Number.isFinite(result) && result > 0
      ? result
      : 0;
  } catch {
    return 0;
  }
}

/** diffDays lives in a separately-owned module; guard it the same way. */
function safeDiffDays(fromISO: string, toISO: string): number | null {
  try {
    const result = diffDays(fromISO, toISO);
    return typeof result === "number" && Number.isFinite(result)
      ? result
      : null;
  } catch {
    return null;
  }
}

export function computeLifecycle(
  events: TaskEvent[],
  task: {
    created_at?: string;
    completed_at?: string | null;
    completed?: boolean;
    memberships?: any[];
  },
  opts?: { now?: string; currentSection?: string; businessDays?: number[] },
): Lifecycle {
  const list: TaskEvent[] = Array.isArray(events) ? events.filter(Boolean) : [];
  const t = task ?? {};
  const businessDayList = opts?.businessDays;
  const nowISO = opts?.now ?? new Date().toISOString();

  const firstActivityAt = list.length > 0 ? list[0].at || null : null;
  const lastActivityAt =
    list.length > 0 ? list[list.length - 1].at || null : null;

  // ---- created / completed ------------------------------------------------
  const createdAt = t.created_at || firstActivityAt || null;

  const completionEvents = list.filter((e) => e.kind === "completion");
  const lastCompletionEvent =
    completionEvents.length > 0
      ? completionEvents[completionEvents.length - 1]
      : null;

  // An explicit boolean on the task wins; otherwise infer from the event stream
  // (a trailing marked_incomplete means the task was reopened).
  let isComplete: boolean;
  if (typeof t.completed === "boolean") {
    isComplete = t.completed;
  } else if (lastCompletionEvent) {
    isComplete = lastCompletionEvent.to === "completed";
  } else {
    isComplete = Boolean(t.completed_at);
  }

  // Edge case 4: use the LAST "completed" event, not the first, so reopened
  // tasks measure their final trip through the workflow.
  let lastCompletedAt: string | null = null;
  for (const e of completionEvents) {
    if (e.to === "completed" && e.at) lastCompletedAt = e.at;
  }
  const completedAt = isComplete
    ? (lastCompletedAt ?? t.completed_at ?? null)
    : null;

  // ---- timeline anchors ---------------------------------------------------
  // Edge case 2: if the task was added to this project after creation, its
  // section history only starts at that point.
  let anchor = createdAt;
  const addedToProject = list.find(
    (e) => e.kind === "project" && e.raw === "added_to_project",
  );
  if (addedToProject?.at) {
    const anchorMs = ms(anchor);
    const addedMs = ms(addedToProject.at);
    if (addedMs !== null && (anchorMs === null || addedMs > anchorMs)) {
      anchor = addedToProject.at;
    }
  }

  // Timeline close-out: completion if complete, otherwise "now".
  const timelineEnd = completedAt ?? nowISO;

  // ---- section intervals --------------------------------------------------
  const sectionEvents = list.filter((e) => e.kind === "section" && e.at);
  const intervals: SectionInterval[] = [];

  const fallbackSection =
    opts?.currentSection ||
    (Array.isArray(t.memberships)
      ? t.memberships[0]?.section?.name
      : undefined) ||
    UNKNOWN_SECTION;

  if (sectionEvents.length === 0) {
    // Edge case 1: no section events -> one section for the whole life.
    const start = anchor ?? firstActivityAt ?? timelineEnd;
    if (start) {
      intervals.push({
        section: fallbackSection,
        enteredAt: start,
        exitedAt: completedAt,
        days: daysBetween(start, timelineEnd),
        businessDays: bizDays(start, timelineEnd, businessDayList),
      });
    }
  } else {
    const first = sectionEvents[0];

    // The section the task sat in before its first recorded move.
    const leadStart = anchor ?? first.at;
    const leadStartMs = ms(leadStart);
    const firstMoveMs = ms(first.at);
    if (
      leadStartMs !== null &&
      firstMoveMs !== null &&
      firstMoveMs > leadStartMs
    ) {
      intervals.push({
        section: first.from || fallbackSection,
        enteredAt: leadStart,
        exitedAt: first.at,
        days: daysBetween(leadStart, first.at),
        businessDays: bizDays(leadStart, first.at, businessDayList),
      });
    }

    for (let i = 0; i < sectionEvents.length; i++) {
      const ev = sectionEvents[i];
      const next = sectionEvents[i + 1];
      // Edge case 5: contiguity — this interval ends exactly where the next
      // one begins; the final interval ends at completion (or stays open).
      const exitedAt = next ? next.at : completedAt;
      const effectiveEnd = next ? next.at : timelineEnd;
      intervals.push({
        section: ev.to || UNKNOWN_SECTION,
        enteredAt: ev.at,
        exitedAt,
        days: daysBetween(ev.at, effectiveEnd),
        businessDays: bizDays(ev.at, effectiveEnd, businessDayList),
      });
    }
  }

  // ---- section totals (edge case 3: re-entry accumulates visits + days) ---
  const sectionTotals: Record<
    string,
    { days: number; businessDays: number; visits: number }
  > = {};
  for (const interval of intervals) {
    const bucket = sectionTotals[interval.section] ?? {
      days: 0,
      businessDays: 0,
      visits: 0,
    };
    bucket.days = Math.round((bucket.days + interval.days) * 10) / 10;
    bucket.businessDays += interval.businessDays;
    bucket.visits += 1;
    sectionTotals[interval.section] = bucket;
  }

  // ---- reschedules --------------------------------------------------------
  const rescheduleEvents = list.filter((e) => e.kind === "reschedule");
  const reschedulePattern = rescheduleEvents.map((e) => {
    const from = e.from ?? null;
    const to = e.to ?? null;
    // Edge case 8: positive slip = pushed later.
    const slipDays =
      from !== null && to !== null ? safeDiffDays(from, to) : null;
    return { from, to, at: e.at, slipDays };
  });

  // ---- assignment ---------------------------------------------------------
  const assignmentEvents = list.filter((e) => e.kind === "assignment");
  const assignees: string[] = [];
  for (const e of assignmentEvents) {
    const name = e.to;
    if (name && !assignees.includes(name)) assignees.push(name);
  }
  // Handoffs, not total assignment events: the first assignment isn't churn.
  const reassignmentCount = Math.max(0, assignmentEvents.length - 1);

  // ---- flow metrics -------------------------------------------------------
  // Edge case 6: "first work start" = earliest section or assignment event.
  const firstWorkEvent = list.find(
    (e) => e.kind === "section" || e.kind === "assignment",
  );
  const workStart = firstWorkEvent?.at || createdAt;

  const cycleTimeDays =
    completedAt && workStart ? daysBetween(workStart, completedAt) : null;
  // Edge case 7.
  const leadTimeDays =
    completedAt && createdAt ? daysBetween(createdAt, completedAt) : null;

  // Edge case 10.
  const idleAnchor = lastActivityAt ?? createdAt;
  const idleDays = idleAnchor ? daysBetween(idleAnchor, nowISO) : 0;

  return {
    createdAt,
    completedAt,
    firstActivityAt,
    lastActivityAt,
    sectionIntervals: intervals,
    sectionTotals,
    rescheduleCount: rescheduleEvents.length,
    reschedulePattern,
    reassignmentCount,
    assignees,
    idleDays,
    cycleTimeDays,
    leadTimeDays,
    commentCount: list.filter((e) => e.kind === "comment").length,
    participants: participantsFrom(list),
  };
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

export type LifecycleSignals = {
  stalled: { inSection: string; days: number } | null;
  chronicSlip: { rescheduleCount: number; totalSlipDays: number } | null;
  ownershipChurn: { count: number; assignees: string[] } | null;
  reviewBound: { days: number; pctOfCycle: number } | null;
};

const DEFAULT_REVIEW_PATTERN = /review|qa|verif|approv/i;
const DEFAULT_TERMINAL_PATTERN = /done|complete|shipped|closed|archive/i;

/**
 * Derive human-meaningful risk signals from a Lifecycle. Every signal is null
 * when it does not trigger, so callers can report only what fired.
 */
export function computeSignals(
  lc: Lifecycle,
  opts?: {
    stalledBusinessDays?: number;
    chronicSlipCount?: number;
    churnCount?: number;
    reviewPctThreshold?: number;
    reviewSectionPattern?: RegExp;
    terminalSectionPattern?: RegExp;
  },
): LifecycleSignals {
  const stalledBusinessDays = opts?.stalledBusinessDays ?? 7;
  const chronicSlipCount = opts?.chronicSlipCount ?? 3;
  const churnCount = opts?.churnCount ?? 3;
  const reviewPctThreshold = opts?.reviewPctThreshold ?? 0.4;
  const reviewPattern = opts?.reviewSectionPattern ?? DEFAULT_REVIEW_PATTERN;
  const terminalPattern =
    opts?.terminalSectionPattern ?? DEFAULT_TERMINAL_PATTERN;

  const signals: LifecycleSignals = {
    stalled: null,
    chronicSlip: null,
    ownershipChurn: null,
    reviewBound: null,
  };
  if (!lc) return signals;

  // stalled: still sitting in a non-terminal section past the threshold.
  const intervals = lc.sectionIntervals ?? [];
  const current = intervals.length > 0 ? intervals[intervals.length - 1] : null;
  if (
    current &&
    current.exitedAt === null &&
    !terminalPattern.test(current.section) &&
    current.businessDays > stalledBusinessDays
  ) {
    signals.stalled = {
      inSection: current.section,
      days: current.businessDays,
    };
  }

  // chronicSlip: repeatedly pushed out. Only positive slips count as slip.
  if ((lc.rescheduleCount ?? 0) >= chronicSlipCount) {
    let totalSlipDays = 0;
    for (const r of lc.reschedulePattern ?? []) {
      if (typeof r.slipDays === "number" && r.slipDays > 0)
        totalSlipDays += r.slipDays;
    }
    signals.chronicSlip = {
      rescheduleCount: lc.rescheduleCount,
      totalSlipDays,
    };
  }

  // ownershipChurn: too many distinct owners.
  const assignees = lc.assignees ?? [];
  if (assignees.length >= churnCount) {
    signals.ownershipChurn = {
      count: assignees.length,
      assignees: [...assignees],
    };
  }

  // reviewBound: only meaningful once we have a finished cycle to compare to.
  const cycle = lc.cycleTimeDays;
  if (typeof cycle === "number" && cycle > 0) {
    let reviewDays = 0;
    for (const [section, totals] of Object.entries(lc.sectionTotals ?? {})) {
      if (reviewPattern.test(section)) reviewDays += totals.days;
    }
    const pctOfCycle = reviewDays / cycle;
    if (pctOfCycle > reviewPctThreshold) {
      signals.reviewBound = {
        days: Math.round(reviewDays * 10) / 10,
        pctOfCycle: Math.round(pctOfCycle * 1000) / 1000,
      };
    }
  }

  return signals;
}
