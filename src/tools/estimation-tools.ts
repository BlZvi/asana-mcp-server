import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import {
  asanaTimezone,
  maxRequestsPerPrompt,
  resolveWorkspace,
  sprintLengthDays,
} from "../config.js";
import { addDaysISO, todayISO } from "../lib/dates.js";
import { computeLifecycle } from "../lib/lifecycle.js";
import {
  extractPointsValue,
  type PointsField,
  pointsCoverage,
  resolvePointsField,
} from "../lib/points.js";
import { mapWithConcurrency, RequestBudget } from "../lib/rate-limiter.js";
import {
  formatResolveFailure,
  resolveProjectGid,
  resolveTaskGid,
  resolveUserGid,
} from "../lib/resolve.js";
import { parseStories, STORY_OPT_FIELDS } from "../lib/story-parser.js";
import { jsonResponse } from "./helpers.js";
import type { ToolEntry } from "./types.js";

const COMPARABLE_SCAN_CAP = 120;
const CYCLE_TIME_SAMPLE = 12;
const DEFAULT_COMPARABLES = 25;

/** Below this ratio, point-based velocity is noise and must be suppressed. */
export const MIN_POINTS_COVERAGE = 0.5;

/** A period whose completions cluster this tightly looks like a bulk close. */
const BULK_CLOSE_WINDOW_MS = 2 * 60 * 60 * 1000;
const BULK_CLOSE_RATIO = 0.4;

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "at",
  "by",
  "from",
  "up",
  "into",
  "is",
  "are",
  "be",
  "was",
  "were",
  "this",
  "that",
  "it",
  "as",
  "we",
  "our",
  "add",
  "new",
  "make",
  "use",
  "using",
]);

/** Lowercase word tokens, stopworded, minimum length 3. */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const v of a) if (b.has(v)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function tagSet(task: any): Set<string> {
  return new Set(
    (Array.isArray(task?.tags) ? task.tags : [])
      .map((t: any) =>
        typeof t?.name === "string" ? t.name.toLowerCase() : "",
      )
      .filter(Boolean),
  );
}

function sectionOf(task: any): string {
  return task?.memberships?.[0]?.section?.name ?? "";
}

export type Comparable = {
  gid: string;
  name: string;
  permalink_url: string | null;
  points: number | null;
  cycleTimeDays: number | null;
  completedAt: string | null;
  assignee: string | null;
  similarity: number;
  matchReasons: string[];
};

export type ComparablesResult = {
  target: {
    gid: string;
    name: string;
    permalink_url: string | null;
    notes: string;
    tags: string[];
    section: string;
  };
  comparables: Comparable[];
  pointsField: { gid: string; name: string } | null;
  coverage: { candidatesScanned: number; withPoints: number };
};

/**
 * Find historically similar completed tasks to anchor an estimate on.
 *
 * Similarity is deliberately simple and deterministic (token/tag/section
 * overlap, no embeddings) — the server's job is cheap prefiltering, and the
 * model does the final selection with reasoning. Cycle time is attached to each
 * comparable because that is what exposes where past estimates were wrong; an
 * estimate anchored only on prior point values inherits the team's bias.
 */
export async function findComparables(
  client: AsanaClientWrapper,
  taskGid: string,
  projectGid: string | undefined,
  limit: number,
  budget?: RequestBudget,
): Promise<ComparablesResult> {
  const requestBudget = budget ?? new RequestBudget(maxRequestsPerPrompt);

  const target: any = await client.getTask(taskGid, {
    opt_fields:
      "name,notes,permalink_url,tags.name,memberships.section.name,memberships.project.gid,memberships.project.name,projects.gid",
  });

  const scopeGid =
    projectGid ??
    target?.memberships?.[0]?.project?.gid ??
    target?.projects?.[0]?.gid;

  const targetInfo = {
    gid: taskGid,
    name: target?.name ?? "(unnamed)",
    permalink_url: target?.permalink_url ?? null,
    notes: typeof target?.notes === "string" ? target.notes : "",
    tags: [...tagSet(target)],
    section: sectionOf(target),
  };

  if (!scopeGid) {
    return {
      target: targetInfo,
      comparables: [],
      pointsField: null,
      coverage: { candidatesScanned: 0, withPoints: 0 },
    };
  }

  const pointsField = await resolvePointsField(
    client,
    resolveWorkspace(undefined),
    scopeGid,
  ).catch(() => null);

  let candidates: any[] = [];
  if (requestBudget.consume(1)) {
    try {
      const { data } = await client.getTasksForProject(scopeGid, {
        opt_fields:
          "name,notes,completed,completed_at,permalink_url,assignee.name,tags.name,memberships.section.name,custom_fields.name,custom_fields.gid,custom_fields.type,custom_fields.number_value,custom_fields.display_value",
        limit: 100,
      });
      candidates = data;
    } catch {
      candidates = [];
    }
  }

  const completed = candidates
    .filter((t: any) => t?.completed && t?.gid !== taskGid)
    .slice(0, COMPARABLE_SCAN_CAP);

  const targetTokens = tokenize(`${targetInfo.name} ${targetInfo.notes}`);
  const targetTags = new Set(targetInfo.tags);

  const scored = completed.map((t: any) => {
    const tokens = tokenize(`${t?.name ?? ""} ${t?.notes ?? ""}`);
    const tags = tagSet(t);
    const sameSection =
      targetInfo.section !== "" && sectionOf(t) === targetInfo.section;

    const textScore = jaccard(targetTokens, tokens);
    const tagScore = jaccard(targetTags, tags);
    const similarity =
      0.5 * textScore + 0.3 * tagScore + (sameSection ? 0.2 : 0);

    const reasons: string[] = [];
    const sharedTags = [...tags].filter((x) => targetTags.has(x));
    if (sharedTags.length > 0)
      reasons.push(`shared tags: ${sharedTags.join(", ")}`);
    if (sameSection) reasons.push(`same section (${targetInfo.section})`);
    const sharedWords = [...tokens].filter((w) => targetTokens.has(w));
    if (sharedWords.length > 0)
      reasons.push(`shared terms: ${sharedWords.slice(0, 5).join(", ")}`);

    return {
      task: t,
      points: extractPointsValue(t, pointsField),
      similarity,
      matchReasons: reasons,
    };
  });

  scored.sort((a, b) => b.similarity - a.similarity);
  const top = scored.slice(0, Math.max(1, limit));

  // Cycle time needs one story fetch each, so only the strongest handful get it.
  const cycleTargets = top.slice(0, CYCLE_TIME_SAMPLE);
  const cycleTimes = new Map<string, number | null>();
  if (cycleTargets.length > 0 && requestBudget.consume(cycleTargets.length)) {
    const results = await mapWithConcurrency(
      cycleTargets,
      4,
      async (entry): Promise<[string, number | null]> => {
        try {
          const { data } = await client.getAllStoriesForTask(entry.task.gid, {
            opt_fields: STORY_OPT_FIELDS,
          });
          const lc = computeLifecycle(parseStories(data), entry.task, {});
          return [entry.task.gid, lc.cycleTimeDays];
        } catch {
          return [entry.task.gid, null];
        }
      },
    );
    for (const [gid, v] of results) cycleTimes.set(gid, v);
  }

  const comparables: Comparable[] = top.map((entry) => ({
    gid: entry.task.gid,
    name: entry.task.name ?? "(unnamed)",
    permalink_url: entry.task.permalink_url ?? null,
    points: entry.points,
    cycleTimeDays: cycleTimes.get(entry.task.gid) ?? null,
    completedAt: entry.task.completed_at ?? null,
    assignee: entry.task.assignee?.name ?? null,
    similarity: Number(entry.similarity.toFixed(3)),
    matchReasons: entry.matchReasons,
  }));

  return {
    target: targetInfo,
    comparables,
    pointsField: pointsField
      ? { gid: pointsField.gid, name: pointsField.name }
      : null,
    coverage: {
      candidatesScanned: completed.length,
      withPoints: pointsCoverage(completed, pointsField).withPoints,
    },
  };
}

// ---------------------------------------------------------------------------
// Velocity
// ---------------------------------------------------------------------------

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/** Median absolute deviation — robust to the outliers small samples produce. */
function mad(values: number[]): number | null {
  const m = median(values);
  if (m === null) return null;
  return median(values.map((v) => Math.abs(v - m)));
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Detect a bulk close: a large share of the period's completions landing inside
 * a short wall-clock window. These periods distort velocity and are excluded
 * from the median rather than silently inflating it.
 */
function looksLikeBulkClose(tasks: any[]): boolean {
  const times = tasks
    .map((t) => Date.parse(t?.completed_at ?? ""))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
  if (times.length < 5) return false;

  let best = 1;
  let start = 0;
  for (let end = 0; end < times.length; end++) {
    while (times[end] - times[start] > BULK_CLOSE_WINDOW_MS) start++;
    best = Math.max(best, end - start + 1);
  }
  return best / times.length >= BULK_CLOSE_RATIO;
}

export type VelocityPeriod = {
  from: string;
  to: string;
  points: number | null;
  taskCount: number;
  pointsCoverage: number;
  outlier: { reason: string } | null;
};

export type VelocityResult = {
  scope: { kind: string; id: string; name: string };
  pointsField: { gid: string; name: string } | null;
  periods: VelocityPeriod[];
  summary: {
    points: {
      median: number | null;
      mean: number | null;
      mad: number | null;
      min: number | null;
      max: number | null;
      trend: "rising" | "falling" | "stable";
    } | null;
    taskCount: {
      median: number | null;
      mean: number | null;
      mad: number | null;
    };
    coverage: number;
    outlierPeriods: { period: string; reason: string }[];
    suppressedReason: string | null;
  };
  recommendation: {
    commitRange: [number, number] | null;
    unit: "points" | "tasks";
    basis: string;
    confidence: "low" | "medium" | "high";
  };
};

export async function computeVelocity(
  client: AsanaClientWrapper,
  opts: {
    scopeKind: "user" | "project";
    scopeGid: string;
    scopeName: string;
    workspaceGid: string;
    periods: number;
    periodDays: number;
    excludeDates?: Set<string>;
  },
): Promise<VelocityResult> {
  const today = todayISO(asanaTimezone);
  const windows: { from: string; to: string }[] = [];
  for (let i = opts.periods - 1; i >= 0; i--) {
    const to = addDaysISO(today, -i * opts.periodDays);
    const from = addDaysISO(to, -(opts.periodDays - 1));
    windows.push({ from, to });
  }

  const pointsField: PointsField | null = await resolvePointsField(
    client,
    opts.workspaceGid,
    opts.scopeKind === "project" ? opts.scopeGid : undefined,
  ).catch(() => null);

  const baseOpts =
    opts.scopeKind === "user"
      ? { assignee_any: opts.scopeGid, completed: true }
      : { projects_any: opts.scopeGid, completed: true };

  const periods: VelocityPeriod[] = [];
  for (const w of windows) {
    let tasks: any[] = [];
    try {
      const r = await client.searchTasksWindowed(
        opts.workspaceGid,
        {
          ...baseOpts,
          opt_fields:
            "name,completed_at,custom_fields.name,custom_fields.gid,custom_fields.type,custom_fields.number_value,custom_fields.display_value",
        },
        { field: "completed_on", from: w.from, to: w.to },
      );
      tasks = r.data;
    } catch {
      tasks = [];
    }

    const filtered = opts.excludeDates
      ? tasks.filter(
          (t: any) =>
            !opts.excludeDates?.has((t?.completed_at ?? "").slice(0, 10)),
        )
      : tasks;

    const cov = pointsCoverage(filtered, pointsField);
    let sum: number | null = null;
    if (pointsField) {
      sum = 0;
      for (const t of filtered) {
        const v = extractPointsValue(t, pointsField);
        if (v !== null) sum += v;
      }
    }

    periods.push({
      from: w.from,
      to: w.to,
      points: sum,
      taskCount: filtered.length,
      pointsCoverage: cov.ratio,
      outlier: looksLikeBulkClose(filtered) ? { reason: "bulk_close" } : null,
    });
  }

  const clean = periods.filter((p) => p.outlier === null);
  const basis = clean.length >= 3 ? clean : periods;

  const overallCoverage =
    basis.length > 0
      ? basis.reduce((a, p) => a + p.pointsCoverage, 0) / basis.length
      : 0;

  // Point velocity below the coverage floor is worse than no velocity — it
  // looks authoritative while measuring an arbitrary subset of the work.
  const suppressed = !pointsField
    ? "No story-points custom field is configured for this scope."
    : overallCoverage < MIN_POINTS_COVERAGE
      ? `Only ${Math.round(overallCoverage * 100)}% of completed tasks had points set (minimum ${Math.round(MIN_POINTS_COVERAGE * 100)}%).`
      : null;

  const pointValues = basis
    .map((p) => p.points)
    .filter((v): v is number => v !== null);
  const taskValues = basis.map((p) => p.taskCount);

  let trend: "rising" | "falling" | "stable" = "stable";
  const trendSeries = suppressed ? taskValues : pointValues;
  if (trendSeries.length >= 3) {
    const n = trendSeries.length;
    const xMean = (n - 1) / 2;
    const yMean = trendSeries.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (trendSeries[i] - yMean);
      den += (i - xMean) ** 2;
    }
    const slope = den === 0 ? 0 : num / den;
    const spread = mad(trendSeries) ?? 0;
    if (Math.abs(slope) > Math.max(spread, 1e-9)) {
      trend = slope > 0 ? "rising" : "falling";
    }
  }

  const unit: "points" | "tasks" = suppressed ? "tasks" : "points";
  const series = suppressed ? taskValues : pointValues;
  const med = median(series);
  const spread = mad(series) ?? 0;

  // Always a range. A single number gets read as a commitment.
  const commitRange: [number, number] | null =
    med === null
      ? null
      : [Math.max(0, Math.round(med - spread)), Math.round(med + spread)];

  const confidence: "low" | "medium" | "high" =
    basis.length < 3 ? "low" : basis.length < 5 ? "medium" : "high";

  return {
    scope: {
      kind: opts.scopeKind,
      id: opts.scopeGid,
      name: opts.scopeName,
    },
    pointsField: pointsField
      ? { gid: pointsField.gid, name: pointsField.name }
      : null,
    periods,
    summary: {
      points: suppressed
        ? null
        : {
            median: median(pointValues),
            mean: mean(pointValues),
            mad: mad(pointValues),
            min: pointValues.length ? Math.min(...pointValues) : null,
            max: pointValues.length ? Math.max(...pointValues) : null,
            trend,
          },
      taskCount: {
        median: median(taskValues),
        mean: mean(taskValues),
        mad: mad(taskValues),
      },
      coverage: overallCoverage,
      outlierPeriods: periods
        .filter((p) => p.outlier)
        .map((p) => ({
          period: `${p.from}→${p.to}`,
          reason: p.outlier?.reason ?? "unknown",
        })),
      suppressedReason: suppressed,
    },
    recommendation: {
      commitRange,
      unit,
      basis: "median ± MAD over non-outlier periods",
      confidence,
    },
  };
}

export const estimationTools: ToolEntry[] = [
  {
    readOnly: true,
    name: "asana_find_comparable_tasks",
    description:
      "Find completed tasks similar to a target task, to anchor an estimate on real history (reference-class forecasting). Returns each comparable's story points AND its actual cycle time, which is what reveals where past estimates were wrong. Similarity is computed from name/description term overlap, shared tags, and section match. Use this before estimating so the estimate is grounded in what work of this shape has actually cost.",
    inputSchema: {
      task: z
        .string()
        .describe(
          "The task to estimate. A task name, an Asana URL, or a raw GID all work.",
        ),
      project: z
        .string()
        .optional()
        .describe(
          "Project GID to search for comparables in. Defaults to the target task's own project.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe(
          `How many comparables to return (1–50, default ${DEFAULT_COMPARABLES}). Cycle time is only computed for the top ${CYCLE_TIME_SAMPLE}, since each costs an API request.`,
        ),
    },
    handler: async (client, args) => {
      const resolved = await resolveTaskGid(client, args?.task ?? "");
      if (!resolved.ok) {
        return jsonResponse({ error: formatResolveFailure(resolved, "task") });
      }
      const result = await findComparables(
        client,
        resolved.gid,
        args?.project,
        args?.limit ?? DEFAULT_COMPARABLES,
      );
      return jsonResponse(result);
    },
  },
  {
    readOnly: true,
    name: "asana_get_velocity",
    description:
      "Compute delivery velocity for a person or project over recent periods. Reports median and MAD (not mean and stddev — small samples make stddev unstable), detects bulk-close periods and excludes them, and reports what fraction of completed tasks actually had story points. When points coverage is below 50% the point velocity is SUPPRESSED and task-count velocity is returned instead, because low-coverage point velocity looks authoritative while measuring an arbitrary subset. Always returns a commitment RANGE, never a single number.",
    inputSchema: {
      scope: z
        .enum(["user", "project"])
        .describe(
          "Whether to measure a person's throughput (`user`) or a project's (`project`).",
        ),
      scope_id: z
        .string()
        .describe(
          "Who or what to measure: a user GID/email/name/`'me'` when scope is `user`, or a project GID/name/URL when scope is `project`.",
        ),
      periods: z
        .number()
        .int()
        .min(2)
        .max(24)
        .optional()
        .describe("How many past periods to analyze (2–24, default 6)."),
      period_days: z
        .number()
        .int()
        .min(1)
        .max(90)
        .optional()
        .describe(
          `Length of each period in days. Defaults to ASANA_SPRINT_LENGTH_DAYS (currently ${sprintLengthDays}).`,
        ),
      exclude_dates: z
        .string()
        .optional()
        .describe(
          "Comma-separated YYYY-MM-DD dates to exclude (holidays, company shutdowns). Completions on these dates are ignored.",
        ),
      workspace: z
        .string()
        .optional()
        .describe(
          "Workspace GID. Can be omitted if ASANA_DEFAULT_WORKSPACE_GID is set.",
        ),
    },
    handler: async (client, args) => {
      const workspaceGid = resolveWorkspace(args?.workspace);
      const kind = args?.scope as "user" | "project";

      const resolved =
        kind === "user"
          ? await resolveUserGid(client, args?.scope_id ?? "me", workspaceGid)
          : await resolveProjectGid(client, args?.scope_id ?? "", workspaceGid);

      if (!resolved.ok) {
        return jsonResponse({ error: formatResolveFailure(resolved, kind) });
      }

      const excludeDates = args?.exclude_dates
        ? new Set(
            String(args.exclude_dates)
              .split(",")
              .map((s: string) => s.trim())
              .filter((s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)),
          )
        : undefined;

      const result = await computeVelocity(client, {
        scopeKind: kind,
        scopeGid: resolved.gid,
        scopeName: resolved.name ?? resolved.gid,
        workspaceGid,
        periods: args?.periods ?? 6,
        periodDays: args?.period_days ?? sprintLengthDays,
        excludeDates,
      });

      return jsonResponse(result);
    },
  },
];
