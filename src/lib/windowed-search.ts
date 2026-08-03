/**
 * Windowed task search with adaptive bisection.
 *
 * Asana's `/tasks/search` endpoint returns at most 100 results and offers **no**
 * offset pagination. A naive six-month query therefore silently truncates, and a
 * model consuming the result reports it as complete. That is a correctness bug,
 * not a performance one.
 *
 * The fix: slice the requested date range into buckets, query each bucket
 * independently, and recursively bisect any bucket that comes back saturated
 * (i.e. at the 100-result cap) until it fits under the cap or we run out of
 * depth / budget. Whatever cannot be resolved is reported explicitly through
 * {@link SearchCoverage} so callers can state that their numbers are a lower
 * bound instead of pretending otherwise.
 */

import {
  bisect,
  splitRange,
  startOfMonthsBetween,
  widthDays,
} from "./dates.js";
import { mapWithConcurrency } from "./rate-limiter.js";

/** Date field the window is applied to. */
export type WindowField =
  | "completed_on"
  | "created_on"
  | "modified_on"
  | "due_on";

export type SearchCoverage = {
  requestedRange: { from: string; to: string };
  field: WindowField;
  /** Buckets for which a search request was actually issued. */
  bucketsQueried: number;
  requestsUsed: number;
  /** Buckets that hit the result cap and could not be subdivided further. */
  saturatedBuckets: { from: string; to: string; count: number }[];
  complete: boolean;
  budgetExhausted: boolean;
  /**
   * Number of de-duplicated tasks returned.
   *
   * Not in the original spec sketch, but {@link summarizeCoverage} takes only a
   * coverage object and must be able to say "Based on N tasks", so the count
   * lives here rather than forcing every caller to thread it separately.
   */
  totalResults: number;
};

export type WindowedResult = { data: any[]; coverage: SearchCoverage };

export type WindowedOpts = {
  /** Maximum bisection depth per seed bucket. Default 6. */
  maxDepth?: number;
  /** Buckets at or below this width are never bisected. Default 1. */
  minBucketDays?: number;
  /** Hard ceiling on search requests issued. Default 40. */
  maxRequests?: number;
  /** Simultaneous searches per wave. Default 3. */
  concurrency?: number;
  /** How the range is initially sliced. Default "month". */
  seedBucket?: "month" | "week" | "none";
  /** Result count that counts as saturated. Default 100. */
  pageSize?: number;
};

const DEFAULTS = {
  maxDepth: 6,
  minBucketDays: 1,
  maxRequests: 40,
  concurrency: 3,
  seedBucket: "month" as const,
  pageSize: 100,
};

interface Bucket {
  from: string;
  to: string;
  depth: number;
}

/** Build the initial work queue for the requested range. */
function seedBuckets(
  from: string,
  to: string,
  mode: "month" | "week" | "none",
): Bucket[] {
  if (widthDays(from, to) === 0) return [];

  const ranges =
    mode === "month"
      ? startOfMonthsBetween(from, to)
      : mode === "week"
        ? splitRange(from, to, 7)
        : [{ from, to }];

  return ranges.map((range) => ({ ...range, depth: 0 }));
}

/**
 * Build the search options for one bucket.
 *
 * DOT-vs-UNDERSCORE DECISION: we emit dot notation (`completed_on.after`).
 *
 * `AsanaClientWrapper.searchTasks` collects unknown keys into `otherOpts`, then
 * walks a `keyMappings` table renaming `foo_after` -> `foo.after`. Dot keys are
 * not in that table, so they survive untouched and reach the API verbatim —
 * which is exactly the wire format Asana expects. Underscore keys would also
 * work today, but only for as long as the mapping table stays complete.
 *
 * The mapping table does create one hazard: if `baseOpts` already carries an
 * underscore bound for the same field, the rename would run *after* our dot key
 * is set and clobber our window. So we strip both spellings of this field's
 * bounds from `baseOpts` before applying ours — the window owns that field.
 */
function bucketOpts(
  baseOpts: Record<string, any>,
  field: WindowField,
  bucket: Bucket,
): Record<string, any> {
  const opts: Record<string, any> = { ...baseOpts };

  delete opts[`${field}_after`];
  delete opts[`${field}_before`];
  delete opts[`${field}.after`];
  delete opts[`${field}.before`];

  // BOUNDARY HANDLING: Asana's `.after` / `.before` inclusivity is inconsistent
  // across fields (some behave as >=/<=, others as >/<). Rather than guess, we
  // deliberately let adjacent buckets share their boundary date — bisect()
  // produces contiguous halves and we pass both endpoints as-is, so a task
  // landing exactly on an edge is picked up by whichever side includes it.
  // Any resulting double-counting is removed by the gid de-duplication below.
  opts[`${field}.after`] = bucket.from;
  opts[`${field}.before`] = bucket.to;

  return opts;
}

/**
 * Search `range` exhaustively by slicing it into windows and bisecting any
 * window that saturates.
 *
 * `search` is injected so this module never depends on the Asana client:
 * typically `(o) => client.searchTasks(workspace, o)`.
 *
 * Never throws for budget reasons — an exhausted budget yields partial data
 * with `coverage.budgetExhausted === true`.
 */
export async function searchTasksWindowed(
  search: (opts: any) => Promise<{ data: any[] }>,
  baseOpts: Record<string, any>,
  range: { field: WindowField; from: string; to: string },
  opts: WindowedOpts = {},
): Promise<WindowedResult> {
  const maxDepth = Math.max(0, opts.maxDepth ?? DEFAULTS.maxDepth);
  const minBucketDays = Math.max(
    1,
    opts.minBucketDays ?? DEFAULTS.minBucketDays,
  );
  const maxRequests = Math.max(0, opts.maxRequests ?? DEFAULTS.maxRequests);
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULTS.concurrency);
  const pageSize = Math.max(1, opts.pageSize ?? DEFAULTS.pageSize);
  const seedMode = opts.seedBucket ?? DEFAULTS.seedBucket;

  const merged = new Map<string, any>();
  const saturatedBuckets: SearchCoverage["saturatedBuckets"] = [];

  let requestsUsed = 0;
  let bucketsQueried = 0;
  let budgetExhausted = false;
  /** Fallback key counter for the (unexpected) case of a task with no gid. */
  let anonymous = 0;

  const mergeAll = (tasks: any[]): void => {
    for (const task of tasks) {
      const gid = task?.gid;
      const key =
        typeof gid === "string" && gid !== "" ? gid : `__anon_${anonymous++}__`;
      // First write wins: identical tasks from overlapping edges are identical.
      if (!merged.has(key)) merged.set(key, task);
    }
  };

  let level = seedBuckets(range.from, range.to, seedMode);

  while (level.length > 0 && !budgetExhausted) {
    // One wave at a time: the current level runs with bounded concurrency and
    // its children form the next level. Firing the whole tree at once would
    // defeat the point of bisecting (we would issue requests for windows we
    // may never need); going strictly serial would be needlessly slow.
    const outcomes = await mapWithConcurrency(
      level,
      concurrency,
      async (bucket): Promise<Bucket[]> => {
        // Claimed synchronously before any await, so concurrent workers in this
        // wave cannot collectively overshoot the ceiling.
        if (requestsUsed >= maxRequests) {
          budgetExhausted = true;
          return [];
        }
        requestsUsed++;
        bucketsQueried++;

        const response = await search(
          bucketOpts(baseOpts, range.field, bucket),
        );
        const tasks = Array.isArray(response?.data) ? response.data : [];

        if (tasks.length < pageSize) {
          mergeAll(tasks);
          return [];
        }

        // Saturated: the window almost certainly hides more than it returned.
        const halves =
          bucket.depth < maxDepth &&
          widthDays(bucket.from, bucket.to) > minBucketDays
            ? bisect(bucket.from, bucket.to)
            : null;

        if (halves) {
          // Keep the truncated parent results even though the halves will
          // re-fetch this window. They are a strict subset of what the children
          // return, so merging costs nothing (dedupe is by gid) — but if the
          // request budget runs out before the children are queried, this is
          // the difference between returning a lower bound and returning
          // nothing at all.
          mergeAll(tasks);
          return halves.map((half) => ({ ...half, depth: bucket.depth + 1 }));
        }

        // Cannot subdivide further: keep what we got and flag it as a floor.
        mergeAll(tasks);
        saturatedBuckets.push({
          from: bucket.from,
          to: bucket.to,
          count: tasks.length,
        });
        return [];
      },
    );

    level = outcomes.flat();
  }

  // If the budget ran out mid-wave, the remaining queue is dropped without
  // issuing any further requests; `budgetExhausted` tells the caller why.

  const data = [...merged.values()];

  return {
    data,
    coverage: {
      requestedRange: { from: range.from, to: range.to },
      field: range.field,
      bucketsQueried,
      requestsUsed,
      saturatedBuckets,
      complete: saturatedBuckets.length === 0 && !budgetExhausted,
      budgetExhausted,
      totalResults: data.length,
    },
  };
}

/** How many saturated windows to name before collapsing into "…and N more". */
const MAX_LISTED_WINDOWS = 3;

/**
 * One-line, human-readable coverage summary suitable for a prompt footer.
 *
 * The wording is deliberately blunt when data is incomplete: an LLM that reads
 * "Complete." will present counts as authoritative, so anything short of full
 * coverage has to say so in the same breath.
 */
export function summarizeCoverage(c: SearchCoverage): string {
  const windows = c.bucketsQueried === 1 ? "window" : "windows";
  const head = `Based on ${c.totalResults} tasks across ${c.bucketsQueried} ${windows} (${c.requestsUsed} requests).`;

  if (c.complete) return `${head} Complete.`;

  const reasons: string[] = [];

  if (c.saturatedBuckets.length > 0) {
    const cap = Math.min(...c.saturatedBuckets.map((b) => b.count));
    const listed = c.saturatedBuckets
      .slice(0, MAX_LISTED_WINDOWS)
      .map((b) => `${b.from}→${b.to}`);
    const hidden = c.saturatedBuckets.length - listed.length;
    if (hidden > 0) listed.push(`…and ${hidden} more`);

    const count = c.saturatedBuckets.length;
    reasons.push(
      `${count} ${count === 1 ? "window" : "windows"} hit the ${cap}-result cap (${listed.join(", ")})`,
    );
  }

  if (c.budgetExhausted) {
    reasons.push(
      `the ${c.requestsUsed}-request budget was exhausted before every window was searched`,
    );
  }

  return `${head} INCOMPLETE — ${reasons.join("; ")}; counts are a lower bound.`;
}
