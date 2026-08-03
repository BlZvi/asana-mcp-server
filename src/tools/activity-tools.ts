import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import {
  asanaTimezone,
  maxRequestsPerPrompt,
  resolveWorkspace,
} from "../config.js";
import { diffDays, todayISO } from "../lib/dates.js";
import {
  extractPointsValue,
  pointsCoverage,
  resolvePointsField,
} from "../lib/points.js";
import { mapWithConcurrency, RequestBudget } from "../lib/rate-limiter.js";
import { formatResolveFailure, resolveUserGid } from "../lib/resolve.js";
import { STORY_OPT_FIELDS } from "../lib/story-parser.js";
import type { SearchCoverage } from "../lib/windowed-search.js";
import { summarizeCoverage } from "../lib/windowed-search.js";
import { jsonResponse } from "./helpers.js";
import type { ToolEntry } from "./types.js";

/** Scanning stories is one request per task; this bounds the blast radius. */
export const COMMENT_SCAN_CAP = 60;
const COMMENT_SCAN_CONCURRENCY = 4;

const COMPLETED_OPT_FIELDS =
  "name,permalink_url,completed_at,completed,projects.name,projects.gid,custom_fields.name,custom_fields.gid,custom_fields.type,custom_fields.number_value,custom_fields.display_value";
const CREATED_OPT_FIELDS =
  "name,permalink_url,created_at,completed,projects.name,projects.gid";
const OPEN_OPT_FIELDS = "name,permalink_url,due_on,projects.name";

/**
 * Caveats that MUST accompany every activity report.
 *
 * These are not disclaimers for the docs — they are emitted with the data so
 * they survive being pasted into Slack. Each one describes a real bias that
 * changes how the numbers should be read.
 */
export const ACTIVITY_CAVEATS: string[] = [
  "`assignee` reflects the CURRENT assignee, not who did the work. Tasks built by this person and handed off for review are credited to the receiver.",
  "Task granularity varies by person and team — counts are not comparable across individuals.",
  "Bulk task closures can inflate a single period.",
  "Engineering work is undercounted without commit data.",
];

export type ActivityInclude =
  | "completed"
  | "created"
  | "commented"
  | "open_now";

const VALID_INCLUDES: ActivityInclude[] = [
  "completed",
  "created",
  "commented",
  "open_now",
];

/** Parse the comma-separated `include` argument, ignoring unknown entries. */
export function parseInclude(raw: unknown): Set<ActivityInclude> {
  if (typeof raw !== "string" || raw.trim() === "") {
    return new Set<ActivityInclude>(["completed", "created"]);
  }
  const picked = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ActivityInclude =>
      (VALID_INCLUDES as string[]).includes(s),
    );
  return picked.length > 0
    ? new Set(picked)
    : new Set<ActivityInclude>(["completed", "created"]);
}

/** Group tasks into YYYY-MM buckets by the given timestamp field. */
function byMonth(tasks: any[], field: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tasks) {
    const raw = t?.[field];
    if (typeof raw !== "string" || raw.length < 7) continue;
    const key = raw.slice(0, 7);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/** Count tasks per project name. A multi-project task counts once per project. */
function byProject(tasks: any[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tasks) {
    const projects = Array.isArray(t?.projects) ? t.projects : [];
    if (projects.length === 0) {
      out["(no project)"] = (out["(no project)"] ?? 0) + 1;
      continue;
    }
    for (const p of projects) {
      const name = typeof p?.name === "string" ? p.name : "(unnamed)";
      out[name] = (out[name] ?? 0) + 1;
    }
  }
  return out;
}

function compactTask(t: any) {
  return {
    gid: t?.gid ?? null,
    name: t?.name ?? "(unnamed)",
    permalink_url: t?.permalink_url ?? null,
    completed_at: t?.completed_at ?? null,
    projects: (Array.isArray(t?.projects) ? t.projects : []).map(
      (p: any) => p?.name ?? "(unnamed)",
    ),
  };
}

export type UserActivity = {
  user: { gid: string; name: string; email: string | null };
  range: { from: string; to: string; days: number };
  completed: {
    total: number;
    byMonth: Record<string, number>;
    byProject: Record<string, number>;
    tasks?: ReturnType<typeof compactTask>[];
  };
  created: {
    total: number;
    byMonth: Record<string, number>;
    byProject: Record<string, number>;
  };
  commented: { total: number; taskCount: number; capped: boolean } | null;
  openNow: { total: number; overdue: number } | null;
  points: { total: number; coverage: number } | null;
  coverage: {
    completed: SearchCoverage | null;
    created: SearchCoverage | null;
  };
  caveats: string[];
};

/**
 * Gather a user's Asana activity over a date range.
 *
 * Exported so the `/contributions` prompt runs the exact same computation as
 * the tool rather than duplicating (and drifting from) it.
 */
export async function computeUserActivity(
  client: AsanaClientWrapper,
  opts: {
    userGid: string;
    userName: string;
    userEmail: string | null;
    workspaceGid: string;
    from: string;
    to: string;
    include: Set<ActivityInclude>;
    projectFilter?: string;
    detailed?: boolean;
    budget?: RequestBudget;
  },
): Promise<UserActivity> {
  const {
    userGid,
    userName,
    userEmail,
    workspaceGid,
    from,
    to,
    include,
    projectFilter,
    detailed,
  } = opts;
  const budget = opts.budget ?? new RequestBudget(maxRequestsPerPrompt);

  const projectsAny = projectFilter?.trim() || undefined;

  let completedTasks: any[] = [];
  let completedCoverage: SearchCoverage | null = null;
  if (include.has("completed")) {
    const r = await client.searchTasksWindowed(
      workspaceGid,
      {
        assignee_any: userGid,
        completed: true,
        ...(projectsAny ? { projects_any: projectsAny } : {}),
        opt_fields: COMPLETED_OPT_FIELDS,
      },
      { field: "completed_on", from, to },
    );
    completedTasks = r.data;
    completedCoverage = r.coverage;
    budget.consume(r.coverage.requestsUsed);
  }

  let createdTasks: any[] = [];
  let createdCoverage: SearchCoverage | null = null;
  if (include.has("created")) {
    const r = await client.searchTasksWindowed(
      workspaceGid,
      {
        created_by_any: userGid,
        ...(projectsAny ? { projects_any: projectsAny } : {}),
        opt_fields: CREATED_OPT_FIELDS,
      },
      { field: "created_on", from, to },
    );
    createdTasks = r.data;
    createdCoverage = r.coverage;
    budget.consume(r.coverage.requestsUsed);
  }

  // Current open workload is a point-in-time question, so a plain (capped)
  // search is the right call — no date window applies.
  let openNow: { total: number; overdue: number } | null = null;
  if (include.has("open_now") && budget.consume(1)) {
    try {
      const { data } = await client.searchTasks(workspaceGid, {
        assignee_any: userGid,
        completed: false,
        ...(projectsAny ? { projects_any: projectsAny } : {}),
        opt_fields: OPEN_OPT_FIELDS,
      });
      const today = todayISO(asanaTimezone);
      openNow = {
        total: data.length,
        overdue: data.filter((t: any) => t?.due_on && t.due_on < today).length,
      };
    } catch {
      openNow = null;
    }
  }

  // Comment scanning: Asana exposes no "stories by user" endpoint, so the only
  // route is one story fetch per candidate task. Hard-capped and opt-in.
  let commented: { total: number; taskCount: number; capped: boolean } | null =
    null;
  if (include.has("commented")) {
    const seen = new Map<string, any>();
    for (const t of [...completedTasks, ...createdTasks]) {
      if (t?.gid && !seen.has(t.gid)) seen.set(t.gid, t);
    }
    const candidates = [...seen.values()];
    const capped = candidates.length > COMMENT_SCAN_CAP;
    const scanned = candidates.slice(0, COMMENT_SCAN_CAP);

    let total = 0;
    let taskCount = 0;
    if (scanned.length > 0 && budget.consume(scanned.length)) {
      const results = await mapWithConcurrency(
        scanned,
        COMMENT_SCAN_CONCURRENCY,
        async (t: any) => {
          try {
            const { data } = await client.getAllStoriesForTask(t.gid, {
              opt_fields: STORY_OPT_FIELDS,
            });
            return data.filter(
              (s: any) =>
                s?.created_by?.gid === userGid &&
                (s?.resource_subtype === "comment_added" ||
                  s?.type === "comment"),
            ).length;
          } catch {
            return 0;
          }
        },
      );
      for (const n of results) {
        total += n;
        if (n > 0) taskCount += 1;
      }
    }
    commented = { total, taskCount, capped };
  }

  // Points are best-effort: most teams have no points field, and that is a
  // supported state rather than an error.
  let points: { total: number; coverage: number } | null = null;
  if (completedTasks.length > 0) {
    const field = await resolvePointsField(client, workspaceGid);
    if (field) {
      let sum = 0;
      for (const t of completedTasks) {
        const v = extractPointsValue(t, field);
        if (v !== null) sum += v;
      }
      points = {
        total: sum,
        coverage: pointsCoverage(completedTasks, field).ratio,
      };
    }
  }

  const caveats = [...ACTIVITY_CAVEATS];
  for (const [label, cov] of [
    ["completed", completedCoverage],
    ["created", createdCoverage],
  ] as const) {
    if (cov && !cov.complete) {
      caveats.push(
        `The ${label} figures are INCOMPLETE. ${summarizeCoverage(cov)}`,
      );
    }
  }
  if (commented?.capped) {
    caveats.push(
      `Comment activity was sampled from only the first ${COMMENT_SCAN_CAP} candidate tasks — the true comment count is higher.`,
    );
  }

  return {
    user: { gid: userGid, name: userName, email: userEmail },
    range: { from, to, days: Math.max(0, diffDays(from, to)) },
    completed: {
      total: completedTasks.length,
      byMonth: byMonth(completedTasks, "completed_at"),
      byProject: byProject(completedTasks),
      ...(detailed
        ? { tasks: completedTasks.slice(0, 100).map(compactTask) }
        : {}),
    },
    created: {
      total: createdTasks.length,
      byMonth: byMonth(createdTasks, "created_at"),
      byProject: byProject(createdTasks),
    },
    commented,
    openNow,
    points,
    coverage: { completed: completedCoverage, created: createdCoverage },
    caveats,
  };
}

export const activityTools: ToolEntry[] = [
  {
    readOnly: true,
    name: "asana_get_user_activity",
    description:
      "Summarize what a person did in Asana over a date range: tasks completed, tasks created, optional comment activity, and current open workload. Aggregates by month and by project. Uses windowed search to work correctly beyond Asana's 100-result search cap, and always reports coverage so partial results are never mistaken for complete ones. Returns methodology caveats that must be surfaced alongside any figures — notably that `assignee` reflects the CURRENT assignee, not who did the work.",
    inputSchema: {
      user: z
        .string()
        .optional()
        .describe(
          "Who to report on: a user GID, an email address, a display name, or `'me'` for the current token's user. Defaults to `'me'`.",
        ),
      from: z
        .string()
        .describe(
          "Start of the reporting window (YYYY-MM-DD), inclusive. Required.",
        ),
      to: z
        .string()
        .optional()
        .describe(
          "End of the reporting window (YYYY-MM-DD), inclusive. Defaults to today in the configured timezone.",
        ),
      workspace: z
        .string()
        .optional()
        .describe(
          "The GID of the workspace to search. Can be omitted if ASANA_DEFAULT_WORKSPACE_GID is set.",
        ),
      include: z
        .string()
        .optional()
        .describe(
          "Comma-separated data to gather: `completed`, `created`, `commented`, `open_now`. Defaults to `completed,created`. NOTE: `commented` is expensive — it costs one API request per candidate task (capped at 60) because Asana has no bulk 'stories by user' endpoint.",
        ),
      project_filter: z
        .string()
        .optional()
        .describe(
          "Comma-separated project GIDs to restrict the report to. Omit to cover the whole workspace.",
        ),
      depth: z
        .enum(["summary", "detailed"])
        .optional()
        .describe(
          "`summary` (default) returns aggregate counts only. `detailed` additionally returns up to 100 individual completed tasks with names and permalinks.",
        ),
    },
    handler: async (client, args) => {
      const workspaceGid = resolveWorkspace(args?.workspace);
      const resolved = await resolveUserGid(
        client,
        args?.user?.trim() || "me",
        workspaceGid,
      );
      if (!resolved.ok) {
        return jsonResponse({
          error: formatResolveFailure(resolved, "user"),
        });
      }

      const to = args?.to?.trim() || todayISO(asanaTimezone);
      const from = args?.from?.trim();
      if (!from) {
        return jsonResponse({ error: "`from` (YYYY-MM-DD) is required." });
      }
      if (from > to) {
        return jsonResponse({
          error: `Invalid range: from (${from}) is after to (${to}).`,
        });
      }

      let email: string | null = null;
      try {
        const u: any = await client.getUser(resolved.gid, {
          opt_fields: "gid,name,email",
        });
        email = u?.email ?? null;
      } catch {
        email = null;
      }

      const activity = await computeUserActivity(client, {
        userGid: resolved.gid,
        userName: resolved.name ?? resolved.gid,
        userEmail: email,
        workspaceGid,
        from,
        to,
        include: parseInclude(args?.include),
        projectFilter: args?.project_filter,
        detailed: args?.depth === "detailed",
      });

      return jsonResponse(activity);
    },
  },
];
