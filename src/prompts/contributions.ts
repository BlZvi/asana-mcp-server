import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import { asanaTimezone, resolveWorkspace } from "../config.js";
import { addDaysISO, diffDays, todayISO } from "../lib/dates.js";
import { formatResolveFailure, resolveUserGid } from "../lib/resolve.js";
import { summarizeCoverage } from "../lib/windowed-search.js";
import {
  computeUserActivity,
  parseInclude,
  type UserActivity,
} from "../tools/activity-tools.js";
import type { PromptEntry } from "./types.js";

const PERIOD_DAYS: Record<string, number> = {
  "1m": 30,
  "3m": 90,
  "6m": 182,
  "1y": 365,
};

function userMessage(text: string): GetPromptResult {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

/** Prompt args arrive as strings; treat anything but an explicit "false" as true. */
function parseBool(raw: unknown, def: boolean): boolean {
  if (typeof raw !== "string" || raw.trim() === "") return def;
  const v = raw.trim().toLowerCase();
  if (v === "false" || v === "no" || v === "0") return false;
  if (v === "true" || v === "yes" || v === "1") return true;
  return def;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Render a `label | count` markdown table, largest first. */
function table(
  header: [string, string],
  rows: Record<string, number>,
  limit = 12,
): string {
  const entries = Object.entries(rows).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "  None";
  const shown = entries.slice(0, limit);
  const body = shown.map(([k, v]) => `| ${k} | ${v} |`).join("\n");
  const more =
    entries.length > limit ? `\n\n  ...and ${entries.length - limit} more` : "";
  return `| ${header[0]} | ${header[1]} |\n|---|---:|\n${body}${more}`;
}

/** Monthly table merging completed and created counts on a shared month axis. */
function monthlyTable(a: UserActivity): string {
  const months = [
    ...new Set([
      ...Object.keys(a.completed.byMonth),
      ...Object.keys(a.created.byMonth),
    ]),
  ].sort();
  if (months.length === 0) return "  No activity in this window";
  const rows = months
    .map(
      (m) =>
        `| ${m} | ${a.completed.byMonth[m] ?? 0} | ${a.created.byMonth[m] ?? 0} |`,
    )
    .join("\n");
  return `| Month | Completed | Created |\n|---|---:|---:|\n${rows}`;
}

function notableTasks(a: UserActivity): string {
  const tasks = a.completed.tasks ?? [];
  if (tasks.length === 0)
    return "  (Run with depth=detailed for task-level examples)";
  return tasks
    .slice(0, 10)
    .map((t) => {
      const label = t.permalink_url
        ? `[${t.name}](${t.permalink_url})`
        : t.name;
      const proj = t.projects.length > 0 ? ` — ${t.projects.join(", ")}` : "";
      return `  - ${label}${proj}`;
    })
    .join("\n");
}

function delta(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? "no change" : `+${current} (new)`;
  const pct = Math.round(((current - previous) / previous) * 100);
  const sign = pct > 0 ? "+" : "";
  return `${current} vs ${previous} (${sign}${pct}%)`;
}

export const contributionsPrompt: PromptEntry = {
  name: "contributions",
  description:
    "Summarize a person's Asana work over a period: what they completed and created, how it was distributed across projects and months, and how it compares to the previous period. Pre-fetches everything using windowed search so results are not silently truncated. Reports methodology caveats alongside the figures.",
  readOnly: true,
  argsSchema: {
    user: z
      .string()
      .optional()
      .describe(
        "Who to report on: a GID, email address, display name, or `'me'` (default).",
      ),
    period: z
      .enum(["1m", "3m", "6m", "1y", "custom"])
      .optional()
      .describe(
        "Reporting window, counting back from today. Defaults to `3m`. Use `custom` together with `from`/`to` for an explicit range.",
      ),
    from: z
      .string()
      .optional()
      .describe("Start date (YYYY-MM-DD). Only used when period is `custom`."),
    to: z
      .string()
      .optional()
      .describe(
        "End date (YYYY-MM-DD). Only used when period is `custom`. Defaults to today.",
      ),
    compare_to_previous: z
      .string()
      .optional()
      .describe(
        "`true` (default) or `false`. When true, also fetches the immediately-preceding equal-length window so trends can be shown. Roughly doubles the API cost.",
      ),
    include_comments: z
      .string()
      .optional()
      .describe(
        "`true` or `false` (default). Comment activity requires one API request per task (capped at 60), so it is off by default.",
      ),
    workspace_gid: z
      .string()
      .optional()
      .describe(
        "Workspace GID to search in. Defaults to ASANA_DEFAULT_WORKSPACE_GID.",
      ),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const workspaceGid = resolveWorkspace(args?.workspace_gid);
    const resolved = await resolveUserGid(
      client,
      args?.user?.trim() || "me",
      workspaceGid,
    );
    if (!resolved.ok) {
      return userMessage(
        `Could not produce a contributions report.

${formatResolveFailure(resolved, "user")}

Ask the user who they meant, then re-run \`/contributions\`.`,
      );
    }

    const today = todayISO(asanaTimezone);
    const period = args?.period ?? "3m";

    let from: string;
    let to: string;
    if (period === "custom") {
      to = ISO_RE.test(args?.to ?? "") ? (args?.to as string) : today;
      from = ISO_RE.test(args?.from ?? "")
        ? (args?.from as string)
        : addDaysISO(to, -90);
    } else {
      to = today;
      from = addDaysISO(to, -(PERIOD_DAYS[period] ?? 90));
    }
    if (from > to) [from, to] = [to, from];

    const includeComments = parseBool(args?.include_comments, false);
    const compare = parseBool(args?.compare_to_previous, true);
    const include = parseInclude(
      includeComments
        ? "completed,created,commented,open_now"
        : "completed,created,open_now",
    );

    let email: string | null = null;
    try {
      const u: any = await client.getUser(resolved.gid, {
        opt_fields: "gid,name,email",
      });
      email = u?.email ?? null;
    } catch {
      email = null;
    }

    const shared = {
      userGid: resolved.gid,
      userName: resolved.name ?? resolved.gid,
      userEmail: email,
      workspaceGid,
      include,
      detailed: true,
    };

    const current = await computeUserActivity(client, { ...shared, from, to });

    const spanDays = Math.max(1, diffDays(from, to));
    let previous: UserActivity | null = null;
    if (compare) {
      const prevTo = addDaysISO(from, -1);
      const prevFrom = addDaysISO(prevTo, -spanDays);
      previous = await computeUserActivity(client, {
        ...shared,
        from: prevFrom,
        to: prevTo,
        include: new Set(["completed", "created"] as const),
        detailed: false,
      });
    }

    const who = current.user.name;

    // Zero activity is a real answer, not an error — say so plainly rather
    // than emitting an empty skeleton of tables.
    if (current.completed.total === 0 && current.created.total === 0) {
      return userMessage(
        `**${who}** has no recorded Asana activity between ${from} and ${to}.

No tasks were completed or created in this window${current.openNow ? `, though they currently have ${current.openNow.total} open task${current.openNow.total === 1 ? "" : "s"} assigned` : ""}.

Tell the user this plainly and suggest possible reasons:
- They may work primarily outside Asana (note: engineering work is undercounted without commit data)
- Tasks they worked on may be assigned to someone else — \`assignee\` reflects the CURRENT assignee, not who did the work
- They may be in a different workspace
- The window may not overlap their active period

Do not speculate about the person's productivity.`,
      );
    }

    const comparisonSection = previous
      ? `## Compared to the Previous Period (${previous.range.from} → ${previous.range.to})
- **Completed:** ${delta(current.completed.total, previous.completed.total)}
- **Created:** ${delta(current.created.total, previous.created.total)}`
      : "";

    const commentSection = current.commented
      ? `## Comment Activity
- **Comments posted:** ${current.commented.total} across ${current.commented.taskCount} task${current.commented.taskCount === 1 ? "" : "s"}${current.commented.capped ? " (sampled — see caveats)" : ""}`
      : "";

    const openSection = current.openNow
      ? `## Current Open Workload (point-in-time, not part of the window)
- **Open tasks:** ${current.openNow.total} · **Overdue:** ${current.openNow.overdue}`
      : "";

    const pointsSection = current.points
      ? `## Story Points
- **Total on completed tasks:** ${current.points.total} (${Math.round(current.points.coverage * 100)}% of completed tasks had points set)`
      : "";

    const coverageLines = [
      current.coverage.completed
        ? `- Completed: ${summarizeCoverage(current.coverage.completed)}`
        : null,
      current.coverage.created
        ? `- Created: ${summarizeCoverage(current.coverage.created)}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    return userMessage(
      `Summarize this person's Asana contributions. All data is pre-fetched — do not re-fetch it. Only call tools to drill into something specific that is not included below.

## ${who}${email ? ` (${email})` : ""}
**Window:** ${from} → ${to} (${current.range.days} days)
- **Completed:** ${current.completed.total} tasks
- **Created:** ${current.created.total} tasks

## Monthly Volume
${monthlyTable(current)}

## Project Distribution — Completed
${table(["Project", "Completed"], current.completed.byProject)}

## Notable Completed Work
${notableTasks(current)}

${comparisonSection}

${commentSection}

${openSection}

${pointsSection}

---
## Coverage
${coverageLines || "- No windowed queries were run."}

## Methodology Caveats
${current.caveats.map((c) => `- ${c}`).join("\n")}

---
Write a summary of this person's contributions covering:

1. **Overview** — Volume and shape of the work over the window. What kinds of things did they work on?
2. **Focus areas** — Which projects or themes absorbed most of their effort, based on the distribution.
3. **Trend** — ${previous ? "How this period compares to the previous one, and any plausible explanation visible in the data." : "Month-over-month movement within the window."}
4. **Notable work** — Specific items worth calling out, with their links.

Describe patterns and notable work. Do NOT rank, grade, or evaluate this person. Do NOT infer productivity from task counts — task size varies enormously. Surface the listed caveats inline wherever they materially affect a number you cite.`,
    );
  },
};
