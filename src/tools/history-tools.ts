/**
 * Task history and project flow-metric tools.
 *
 * Both tools are built on the story stream: Asana does not expose cycle time,
 * section dwell time or reschedule history as fields, so the only way to get
 * them is to replay each task's activity log (see ../lib/story-parser.js) and
 * fold it into a lifecycle (see ../lib/lifecycle.js).
 *
 * That makes the project-level tool expensive — one stories request per sampled
 * task — so it is bounded on three axes: a hard task cap, a shared
 * {@link RequestBudget}, and bounded concurrency.
 */

import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import { businessDays, maxRequestsPerPrompt } from "../config.js";
import { addDaysISO, todayISO } from "../lib/dates.js";
import {
  computeLifecycle,
  computeSignals,
  type Lifecycle,
} from "../lib/lifecycle.js";
import { mapWithConcurrency, RequestBudget } from "../lib/rate-limiter.js";
import {
  formatResolveFailure,
  resolveProjectGid,
  resolveTaskGid,
} from "../lib/resolve.js";
import {
  parseStories,
  STORY_OPT_FIELDS,
  type TaskEvent,
} from "../lib/story-parser.js";
import { jsonResponse } from "./helpers.js";
import type { ToolEntry } from "./types.js";

/** opt_fields needed to build a full lifecycle for a single task. */
const TASK_HISTORY_OPT_FIELDS =
  "name,permalink_url,completed,completed_at,created_at,assignee.name,memberships.section.name,memberships.project.name,num_subtasks";

/** Lean opt_fields for the per-task fan-out in the flow-metrics computation. */
const FLOW_TASK_OPT_FIELDS =
  "name,permalink_url,completed,completed_at,created_at,assignee.name,memberships.section.name,memberships.project.name";

/** Hard ceiling on how many tasks the flow-metrics tool will ever sample. */
const MAX_FLOW_TASKS = 100;
/** Default sample size when the caller does not specify one. */
const DEFAULT_FLOW_TASKS = 50;
/** Default lookback window for "recently completed". */
const DEFAULT_LOOKBACK_DAYS = 90;
/** Simultaneous story fetches during the flow-metrics fan-out. */
const FLOW_CONCURRENCY = 4;
/** Page size used when listing a project's tasks. Asana's max is 100. */
const PROJECT_PAGE_LIMIT = 100;
/** Number of entries in each "worst offender" list. */
const OFFENDER_COUNT = 5;

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/**
 * Nearest-rank percentile over an ASCENDING-sorted array.
 *
 * Returns null for an empty sample rather than NaN so downstream renderers can
 * print "n/a" instead of leaking a NaN into a report. `p` is a fraction in
 * [0, 1] and is clamped, so `percentile(xs, 2)` yields the maximum.
 */
export function percentile(sorted: number[], p: number): number | null {
  if (!Array.isArray(sorted) || sorted.length === 0) return null;
  if (!Number.isFinite(p)) return null;

  const clamped = Math.min(1, Math.max(0, p));
  const rank = Math.ceil(clamped * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  const value = sorted[index];
  return typeof value === "number" && Number.isFinite(value)
    ? round1(value)
    : null;
}

/** Arithmetic mean, or null for an empty sample. Never NaN. */
function mean(values: number[]): number | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  let total = 0;
  for (const value of values) total += value;
  const result = total / values.length;
  return Number.isFinite(result) ? round1(result) : null;
}

/** Median of an UNSORTED array, or null when empty. */
function median(values: number[]): number | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const result =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Number.isFinite(result) ? round1(result) : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Ascending numeric copy, dropping anything non-finite. */
function sortedFinite(values: (number | null | undefined)[]): number[] {
  const clean: number[] = [];
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) clean.push(value);
  }
  return clean.sort((a, b) => a - b);
}

/** Monday (UTC) of the week containing an ISO timestamp, as YYYY-MM-DD. */
function weekStartOf(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const date = new Date(ms);
  // getUTCDay(): 0 = Sunday. Shift so Monday is the first day of the week.
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Flow metrics
// ---------------------------------------------------------------------------

export type Percentiles = {
  p50: number | null;
  p85: number | null;
  p95: number | null;
};

export type FlowTaskRef = {
  gid: string;
  name: string;
  permalink_url: string | null;
};

export type FlowMetrics = {
  project: { gid: string; name: string; permalink_url: string | null };
  completedSince: string;
  sampled: {
    tasks: number;
    of: number;
    complete: boolean;
    budgetExhausted: boolean;
  };
  cycleTime: Percentiles & { mean: number | null };
  leadTime: Percentiles;
  sectionBottlenecks: {
    section: string;
    p50Days: number | null;
    p85Days: number | null;
    taskCount: number;
  }[];
  throughputByWeek: { weekStart: string; completed: number }[];
  reschedule: {
    tasksAffected: number;
    pctOfTasks: number | null;
    medianSlipDays: number | null;
  };
  worstOffenders: {
    mostRescheduled: (FlowTaskRef & { rescheduleCount: number })[];
    longestCycle: (FlowTaskRef & { cycleTimeDays: number })[];
    mostChurned: (FlowTaskRef & { assigneeCount: number })[];
  };
};

/** Normalise an Asana task object into a renderable reference. */
function taskRef(task: any): FlowTaskRef {
  return {
    gid: typeof task?.gid === "string" ? task.gid : "",
    name: typeof task?.name === "string" ? task.name : "(unnamed task)",
    permalink_url:
      typeof task?.permalink_url === "string" ? task.permalink_url : null,
  };
}

/**
 * Compute flow metrics for a project from its recently-completed tasks.
 *
 * SOURCE CHOICE: this uses `getTasksForProject` + a client-side
 * `completed && completed_at >= since` filter rather than the search API.
 * Reasons: (a) the search endpoint is not available on every Asana plan and
 * silently 402s on free tiers, which would make the tool fail for some users
 * outright; (b) search results are capped and unsorted by completion, so
 * paginating them costs the same as listing the project anyway; (c) listing the
 * project gives an accurate denominator for the coverage footer, which search
 * cannot provide. The trade-off is that very large projects need several list
 * pages before the sample fills — bounded here by the request budget.
 *
 * Exported so `/flow-report` can reuse the exact same computation as the tool
 * rather than duplicating (and drifting from) it.
 */
export async function computeFlowMetrics(
  client: AsanaClientWrapper,
  projectGid: string,
  since: string,
  maxTasks: number,
  budget?: RequestBudget,
): Promise<FlowMetrics> {
  const cap = Math.min(
    MAX_FLOW_TASKS,
    Math.max(1, Math.trunc(maxTasks) || DEFAULT_FLOW_TASKS),
  );
  const requestBudget = budget ?? new RequestBudget(maxRequestsPerPrompt);
  let budgetExhausted = false;

  // --- project header ------------------------------------------------------
  let project: any = { gid: projectGid, name: projectGid, permalink_url: null };
  if (requestBudget.consume(1)) {
    try {
      project = await client.getProject(projectGid, {
        opt_fields: "name,permalink_url",
      });
    } catch {
      // A missing header must not sink the whole report.
    }
  } else {
    budgetExhausted = true;
  }

  // --- candidate tasks -----------------------------------------------------
  const allTasks: any[] = [];
  let offset: string | undefined;
  let listedAll = false;

  while (true) {
    if (!requestBudget.consume(1)) {
      budgetExhausted = true;
      break;
    }
    let page: { data: any[]; next_page: { offset: string } | null };
    try {
      page = (await client.getTasksForProject(projectGid, {
        opt_fields: FLOW_TASK_OPT_FIELDS,
        limit: PROJECT_PAGE_LIMIT,
        ...(offset ? { offset } : {}),
      })) as any;
    } catch {
      break;
    }
    if (Array.isArray(page?.data)) allTasks.push(...page.data);
    offset = page?.next_page?.offset;
    if (!offset) {
      listedAll = true;
      break;
    }
  }

  const completedTasks = allTasks.filter((task) => {
    if (!task?.completed) return false;
    const at = typeof task.completed_at === "string" ? task.completed_at : "";
    // completed_at is a full timestamp; `since` is a date. Prefix comparison on
    // ISO strings is a correct chronological comparison here.
    return at !== "" && at.slice(0, 10) >= since;
  });

  // Newest completions first: the recent past is the more useful sample when
  // the cap forces us to discard some.
  completedTasks.sort((a, b) =>
    String(b.completed_at ?? "").localeCompare(String(a.completed_at ?? "")),
  );

  const sample = completedTasks.slice(0, cap);

  // --- per-task lifecycle fan-out -----------------------------------------
  type Sampled = { task: any; lifecycle: Lifecycle } | null;

  const sampled: Sampled[] = await mapWithConcurrency(
    sample,
    FLOW_CONCURRENCY,
    async (task): Promise<Sampled> => {
      if (!requestBudget.consume(1)) {
        budgetExhausted = true;
        return null;
      }
      try {
        const stories = await client.getAllStoriesForTask(task.gid, {
          opt_fields: STORY_OPT_FIELDS,
        });
        const events = parseStories(stories.data);
        const lifecycle = computeLifecycle(events, task, { businessDays });
        return { task, lifecycle };
      } catch {
        return null;
      }
    },
  );

  const rows = sampled.filter(
    (row): row is { task: any; lifecycle: Lifecycle } => row !== null,
  );

  // --- aggregates ----------------------------------------------------------
  const cycleTimes = sortedFinite(rows.map((r) => r.lifecycle.cycleTimeDays));
  const leadTimes = sortedFinite(rows.map((r) => r.lifecycle.leadTimeDays));

  const sectionSamples = new Map<string, number[]>();
  for (const row of rows) {
    for (const [section, totals] of Object.entries(
      row.lifecycle.sectionTotals ?? {},
    )) {
      const bucket = sectionSamples.get(section) ?? [];
      bucket.push(totals.days);
      sectionSamples.set(section, bucket);
    }
  }

  const sectionBottlenecks = [...sectionSamples.entries()]
    .map(([section, days]) => {
      const sorted = sortedFinite(days);
      return {
        section,
        p50Days: percentile(sorted, 0.5),
        p85Days: percentile(sorted, 0.85),
        taskCount: sorted.length,
      };
    })
    .sort((a, b) => (b.p50Days ?? -1) - (a.p50Days ?? -1));

  const weekCounts = new Map<string, number>();
  for (const row of rows) {
    const completedAt = row.lifecycle.completedAt ?? row.task?.completed_at;
    if (typeof completedAt !== "string") continue;
    const week = weekStartOf(completedAt);
    if (!week) continue;
    weekCounts.set(week, (weekCounts.get(week) ?? 0) + 1);
  }
  const throughputByWeek = [...weekCounts.entries()]
    .map(([weekStart, completed]) => ({ weekStart, completed }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  const rescheduledRows = rows.filter((r) => r.lifecycle.rescheduleCount > 0);
  const slipDays: number[] = [];
  for (const row of rescheduledRows) {
    for (const entry of row.lifecycle.reschedulePattern ?? []) {
      // Only pushes count as slip; pulling a date earlier is not a delay.
      if (typeof entry.slipDays === "number" && entry.slipDays > 0) {
        slipDays.push(entry.slipDays);
      }
    }
  }

  const mostRescheduled = rows
    .filter((r) => r.lifecycle.rescheduleCount > 0)
    .sort((a, b) => b.lifecycle.rescheduleCount - a.lifecycle.rescheduleCount)
    .slice(0, OFFENDER_COUNT)
    .map((r) => ({
      ...taskRef(r.task),
      rescheduleCount: r.lifecycle.rescheduleCount,
    }));

  const longestCycle = rows
    .filter((r) => typeof r.lifecycle.cycleTimeDays === "number")
    .sort(
      (a, b) =>
        (b.lifecycle.cycleTimeDays ?? 0) - (a.lifecycle.cycleTimeDays ?? 0),
    )
    .slice(0, OFFENDER_COUNT)
    .map((r) => ({
      ...taskRef(r.task),
      cycleTimeDays: r.lifecycle.cycleTimeDays as number,
    }));

  const mostChurned = rows
    .filter((r) => (r.lifecycle.assignees?.length ?? 0) > 1)
    .sort(
      (a, b) =>
        (b.lifecycle.assignees?.length ?? 0) -
        (a.lifecycle.assignees?.length ?? 0),
    )
    .slice(0, OFFENDER_COUNT)
    .map((r) => ({
      ...taskRef(r.task),
      assigneeCount: r.lifecycle.assignees?.length ?? 0,
    }));

  return {
    project: taskRef(project),
    completedSince: since,
    sampled: {
      tasks: rows.length,
      of: completedTasks.length,
      // "complete" means we both saw every page and analysed every candidate.
      complete: listedAll && rows.length === completedTasks.length,
      budgetExhausted,
    },
    cycleTime: {
      p50: percentile(cycleTimes, 0.5),
      p85: percentile(cycleTimes, 0.85),
      p95: percentile(cycleTimes, 0.95),
      // Secondary only: cycle time is right-skewed, so the mean overstates the
      // typical case. Percentiles are the headline.
      mean: mean(cycleTimes),
    },
    leadTime: {
      p50: percentile(leadTimes, 0.5),
      p85: percentile(leadTimes, 0.85),
      p95: percentile(leadTimes, 0.95),
    },
    sectionBottlenecks,
    throughputByWeek,
    reschedule: {
      tasksAffected: rescheduledRows.length,
      pctOfTasks:
        rows.length > 0
          ? Math.round((rescheduledRows.length / rows.length) * 1000) / 10
          : null,
      medianSlipDays: median(slipDays),
    },
    worstOffenders: { mostRescheduled, longestCycle, mostChurned },
  };
}

/** Default `completed_since`: DEFAULT_LOOKBACK_DAYS ago in the configured tz. */
export function defaultCompletedSince(): string {
  return addDaysISO(todayISO(), -DEFAULT_LOOKBACK_DAYS);
}

/** Accept only a well-formed YYYY-MM-DD; anything else falls back to the default. */
export function normalizeSince(input: unknown): string {
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    return input.trim();
  }
  return defaultCompletedSince();
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const historyTools: ToolEntry[] = [
  {
    readOnly: true,
    name: "asana_get_task_history",
    description:
      "Reconstruct a task's full lifecycle from its Asana activity stream. Returns the chronological event timeline (assignments, section moves, reschedules, completions, custom-field changes, comments), how long the task spent in each section, cycle/lead time, reschedule history with slip days, ownership churn, and triggered risk signals (stalled, chronic slip, ownership churn, review-bound). Use this to answer 'why is this task late?', 'where did it get stuck?' or 'who has touched it?'. Accepts a task GID, an Asana task URL, or a task name. Costs 2–3 API requests (more for very long activity streams).",
    inputSchema: {
      task: z
        .string()
        .describe(
          "The task to analyze. Accepts a GID (`'19234567890123'`), any Asana task URL (`'https://app.asana.com/0/12345/67890'`), or a task name to resolve via typeahead (e.g. `'Fix login bug'`). Names that match several tasks return a disambiguation list instead of an error.",
        ),
      project: z
        .string()
        .optional()
        .describe(
          "Optional project GID, URL, or name. Only useful for tasks that live in multiple projects: it selects which project's section the task is considered to currently sit in, which changes the section timeline. Ignored when the task belongs to a single project.",
        ),
      include_subtasks: z
        .boolean()
        .optional()
        .describe(
          "When true, also return a compact list of the task's subtasks (gid, name, completed, assignee, permalink). Full lifecycles are NOT computed per subtask because that would cost one extra request each. Defaults to false.",
        ),
    },
    handler: async (client, args) => {
      const resolved = await resolveTaskGid(client, String(args?.task ?? ""));
      if (!resolved.ok) {
        return jsonResponse({ error: formatResolveFailure(resolved, "task") });
      }
      const taskGid = resolved.gid;

      // Resolve the disambiguating project up front so the section fallback can
      // use it. A failure here is non-fatal — it only affects the fallback.
      let projectFilterGid: string | null = null;
      if (typeof args?.project === "string" && args.project.trim() !== "") {
        const project = await resolveProjectGid(client, args.project);
        if (project.ok) projectFilterGid = project.gid;
      }

      const [task, stories] = await Promise.all([
        client.getTask(taskGid, { opt_fields: TASK_HISTORY_OPT_FIELDS }),
        client.getAllStoriesForTask(taskGid, { opt_fields: STORY_OPT_FIELDS }),
      ]);

      const memberships: any[] = Array.isArray((task as any).memberships)
        ? (task as any).memberships
        : [];
      const membership = projectFilterGid
        ? memberships.find((m) => m?.project?.gid === projectFilterGid)
        : memberships[0];
      const currentSection: string | undefined = membership?.section?.name;

      const timeline: TaskEvent[] = parseStories(stories.data);
      const lifecycle = computeLifecycle(timeline, task as any, {
        currentSection,
        businessDays,
      });
      const signals = computeSignals(lifecycle);

      const result: Record<string, any> = {
        task: {
          gid: (task as any).gid ?? taskGid,
          name: (task as any).name ?? null,
          permalink_url: (task as any).permalink_url ?? null,
          completed: Boolean((task as any).completed),
          assignee: (task as any).assignee?.name ?? null,
        },
        lifecycle,
        timeline,
        signals,
        storiesTruncated: Boolean(stories.truncated),
      };

      if (args?.include_subtasks === true) {
        try {
          const { data: subtasks } = await client.getSubtasksForTask(taskGid, {
            opt_fields: "name,completed,assignee.name,permalink_url",
          });
          result.subtasks = (subtasks ?? []).map((subtask: any) => ({
            gid: subtask?.gid ?? null,
            name: subtask?.name ?? null,
            completed: Boolean(subtask?.completed),
            assignee: subtask?.assignee?.name ?? null,
            permalink_url: subtask?.permalink_url ?? null,
          }));
        } catch {
          result.subtasks = [];
          result.subtasksError = "Failed to fetch subtasks.";
        }
      }

      return jsonResponse(result);
    },
  },
  {
    readOnly: true,
    name: "asana_get_project_flow_metrics",
    description:
      "Compute delivery-flow statistics for a project by replaying the activity stream of its recently-completed tasks. Returns cycle-time and lead-time percentiles (p50/p85/p95 — cycle time is right-skewed, so the mean is reported only as a secondary figure), per-section dwell times ranked worst-first to expose bottlenecks, weekly throughput, reschedule frequency and median slip, and 'worst offender' task lists with clickable permalinks. EXPENSIVE: costs roughly one API request per sampled task, so it is bounded by `max_tasks` (hard cap 100) and by the server-wide per-prompt request budget; the response always states how much of the project was actually sampled. Use this to answer 'where does work get stuck?' or 'how long does delivery actually take?'.",
    inputSchema: {
      project: z
        .string()
        .describe(
          "The project to analyze. Accepts a GID (`'1200000000'`), an Asana project URL (`'https://app.asana.com/0/1200000000/list'`), or a project name to resolve via typeahead (e.g. `'Backend API'`).",
        ),
      completed_since: z
        .string()
        .optional()
        .describe(
          "Only sample tasks completed on or after this date, as `YYYY-MM-DD` (e.g. `'2026-05-01'`). Defaults to 90 days ago. Widen it for slow-moving projects; narrow it to measure a recent process change. Malformed values silently fall back to the default.",
        ),
      max_tasks: z
        .number()
        .optional()
        .describe(
          "Maximum number of completed tasks to sample. Each sampled task costs one extra API request, so keep this small for exploratory questions. Defaults to 50, hard-capped at 100. The most recently completed tasks are sampled first.",
        ),
    },
    handler: async (client, args) => {
      const resolved = await resolveProjectGid(
        client,
        String(args?.project ?? ""),
      );
      if (!resolved.ok) {
        return jsonResponse({
          error: formatResolveFailure(resolved, "project"),
        });
      }

      const since = normalizeSince(args?.completed_since);
      const requested =
        typeof args?.max_tasks === "number" && Number.isFinite(args.max_tasks)
          ? args.max_tasks
          : DEFAULT_FLOW_TASKS;

      const metrics = await computeFlowMetrics(
        client,
        resolved.gid,
        since,
        requested,
      );

      return jsonResponse(metrics);
    },
  },
];
