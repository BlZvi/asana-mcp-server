import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import { resolveWorkspace, sprintLengthDays } from "../config.js";
import {
  formatResolveFailure,
  resolveProjectGid,
  resolveUserGid,
} from "../lib/resolve.js";
import {
  computeVelocity,
  type VelocityResult,
} from "../tools/estimation-tools.js";
import type { PromptEntry } from "./types.js";

function userMessage(text: string): GetPromptResult {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

function parseIntArg(
  raw: unknown,
  def: number,
  min: number,
  max: number,
): number {
  if (typeof raw !== "string" || raw.trim() === "") return def;
  const n = Number.parseInt(raw.trim(), 10);
  if (Number.isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function renderPeriods(v: VelocityResult): string {
  if (v.periods.length === 0) return "  No periods computed.";
  const usePoints = v.summary.suppressedReason === null;
  const rows = v.periods
    .map((p) => {
      const value = usePoints
        ? p.points === null
          ? "—"
          : String(p.points)
        : String(p.taskCount);
      const flag = p.outlier ? ` ⚠ ${p.outlier.reason}` : "";
      const cov = `${Math.round(p.pointsCoverage * 100)}%`;
      return `| ${p.from} → ${p.to} | ${value} | ${p.taskCount} | ${cov}${flag} |`;
    })
    .join("\n");
  const unit = usePoints ? "Points" : "Tasks";
  return `| Period | ${unit} | Tasks completed | Points coverage |\n|---|---:|---:|---|\n${rows}`;
}

function renderSummary(v: VelocityResult): string {
  const lines: string[] = [];

  if (v.summary.suppressedReason) {
    lines.push(
      `⚠ **Point velocity suppressed.** ${v.summary.suppressedReason}`,
      `Falling back to task-count velocity, which is less precise but honest.`,
      "",
    );
  }

  if (v.summary.points) {
    const p = v.summary.points;
    lines.push(
      `**Points per period** — median ${p.median ?? "—"}, MAD ±${p.mad ?? "—"}, range ${p.min ?? "—"}–${p.max ?? "—"}, trend **${p.trend}**`,
    );
  }
  const t = v.summary.taskCount;
  lines.push(
    `**Tasks per period** — median ${t.median ?? "—"}, MAD ±${t.mad ?? "—"}`,
  );

  if (v.summary.outlierPeriods.length > 0) {
    lines.push(
      "",
      `**Excluded as outliers:** ${v.summary.outlierPeriods.map((o) => `${o.period} (${o.reason})`).join(", ")}`,
      `A "bulk_close" period is one where a large share of completions landed within a two-hour window — usually a backlog cleanup rather than real throughput.`,
    );
  }

  return lines.join("\n");
}

export const sprintCapacityPrompt: PromptEntry = {
  name: "sprint-capacity",
  description:
    "Recommend how much work a person or team should commit to next sprint, based on measured historical velocity rather than guesswork. Detects and excludes bulk-close periods, reports points coverage, and always answers with a range. Use before sprint planning to set a realistic commitment.",
  readOnly: true,
  argsSchema: {
    scope: z
      .enum(["user", "project"])
      .optional()
      .describe(
        "Measure a person (`user`) or a project/team (`project`). Defaults to `project`.",
      ),
    scope_id: z
      .string()
      .describe(
        "Who or what to measure: a project name/GID/URL, or a user name/email/GID/`'me'`.",
      ),
    periods: z
      .string()
      .optional()
      .describe(
        "How many past periods to analyze (2–24, default 6). More periods give a stabler median but blend in older process.",
      ),
    period_days: z
      .string()
      .optional()
      .describe(
        `Length of each period in days (1–90). Defaults to ASANA_SPRINT_LENGTH_DAYS (currently ${sprintLengthDays}).`,
      ),
    team_size: z
      .string()
      .optional()
      .describe(
        "Number of people working the upcoming sprint. Used to scale the recommendation when it differs from the historical team size.",
      ),
    days_off: z
      .string()
      .optional()
      .describe(
        "Total planned person-days off during the upcoming sprint (PTO, holidays, on-call). Used to discount the commitment.",
      ),
    exclude_dates: z
      .string()
      .optional()
      .describe(
        "Comma-separated YYYY-MM-DD dates to exclude from the historical baseline (e.g. a company shutdown).",
      ),
    workspace_gid: z
      .string()
      .optional()
      .describe("Workspace GID. Defaults to ASANA_DEFAULT_WORKSPACE_GID."),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const workspaceGid = resolveWorkspace(args?.workspace_gid);
    const kind = (args?.scope ?? "project") as "user" | "project";
    const scopeId = args?.scope_id;

    if (!scopeId || scopeId.trim() === "") {
      throw new Error("scope_id is required (a project or user identifier)");
    }

    const resolved =
      kind === "user"
        ? await resolveUserGid(client, scopeId, workspaceGid)
        : await resolveProjectGid(client, scopeId, workspaceGid);

    if (!resolved.ok) {
      return userMessage(
        `Could not compute sprint capacity.

${formatResolveFailure(resolved, kind)}

Ask the user which ${kind} they meant, then re-run \`/sprint-capacity\`.`,
      );
    }

    const periodDays = parseIntArg(args?.period_days, sprintLengthDays, 1, 90);
    const excludeDates = args?.exclude_dates
      ? new Set(
          args.exclude_dates
            .split(",")
            .map((s) => s.trim())
            .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)),
        )
      : undefined;

    const v = await computeVelocity(client, {
      scopeKind: kind,
      scopeGid: resolved.gid,
      scopeName: resolved.name ?? resolved.gid,
      workspaceGid,
      periods: parseIntArg(args?.periods, 6, 2, 24),
      periodDays,
      excludeDates,
    });

    const anyDelivery = v.periods.some((p) => p.taskCount > 0);
    if (!anyDelivery) {
      return userMessage(
        `No completed work found for **${v.scope.name}** in the last ${v.periods.length} periods of ${periodDays} days.

There is no velocity baseline to project from. Tell the user this and suggest:
- Confirming the team marks tasks complete in Asana rather than only moving them to a "Done" section
- Checking whether work is tracked under a different project or assignee
- Using \`/estimate\` on individual tasks instead, which does not require a velocity history`,
      );
    }

    const range = v.recommendation.commitRange;
    const unit = v.recommendation.unit;
    const teamSize = args?.team_size?.trim();
    const daysOff = args?.days_off?.trim();

    const adjustmentSection =
      teamSize || daysOff
        ? `
## Upcoming Sprint Adjustments
${teamSize ? `- **Team size:** ${teamSize} people\n` : ""}${daysOff ? `- **Planned days off:** ${daysOff} person-days\n` : ""}
Scale the baseline commitment accordingly. State the arithmetic you used so the user can check it. If the historical team size is unknown, say so rather than assuming it matches the upcoming one.`
        : `
No team size or planned time off was provided. Note that the recommendation assumes the upcoming sprint has the same capacity as the historical average, and ask the user to confirm.`;

    return userMessage(
      `Recommend a sprint commitment for this ${kind}. All data is pre-fetched — do not re-fetch it.

## Scope: ${v.scope.name} (${kind})
**Period length:** ${periodDays} days · **Periods analyzed:** ${v.periods.length}

## Historical Velocity
${renderPeriods(v)}

## Summary
${renderSummary(v)}

## Computed Recommendation
- **Commit range:** ${range ? `${range[0]}–${range[1]} ${unit}` : "not computable"}
- **Basis:** ${v.recommendation.basis}
- **Confidence:** ${v.recommendation.confidence}
${adjustmentSection}

---
Produce a capacity recommendation covering:

1. **The number** — State the commitment as a RANGE, never a single figure. A single number gets treated as a promise.

2. **Why this range** — Reference the median and the spread. If the MAD is large relative to the median, the team's throughput is volatile and the range should be wide; say that explicitly.

3. **Trend caveat** — ${v.summary.points?.trend && v.summary.points.trend !== "stable" ? `Velocity is **${v.summary.points.trend}**. Say whether the recent direction should shift the commitment away from the historical median.` : "Velocity looks stable across the measured periods."}

4. **Confidence and what would improve it** — Confidence is **${v.recommendation.confidence}**. ${v.summary.suppressedReason ? "Point coverage was too low to trust, so this is task-count based; recommend setting points consistently if the team wants point-based planning." : "Note how many periods informed the median and what would tighten the estimate."}

5. **Health check** — Flag anything that undermines the figure: outlier periods, low points coverage, too few periods, or a very small sample.

Do not present the range as a target to hit. It is a planning input.`,
    );
  },
};
