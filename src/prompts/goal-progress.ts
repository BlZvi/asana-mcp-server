import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import { asanaTimezone, resolveWorkspace } from "../config.js";
import { diffDays, todayISO } from "../lib/dates.js";
import type { PromptEntry } from "./types.js";

function userMessage(text: string): GetPromptResult {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

const GOAL_STATUS: Record<string, string> = {
  green: "On Track",
  yellow: "At Risk",
  red: "Off Track",
  blue: "On Hold",
  missed: "Missed",
  achieved: "Achieved",
  partial: "Partially Achieved",
  dropped: "Dropped",
};

export const goalProgressPrompt: PromptEntry = {
  name: "goal-progress",
  description:
    "Report progress against Asana goals: current metric values, status, time elapsed versus progress made, and which goals are behind pace. Answers 'how are we tracking against our objectives?'",
  readOnly: true,
  argsSchema: {
    time_period: z
      .string()
      .optional()
      .describe(
        "Time period GID to scope goals to (e.g. a specific quarter). Omit to include all current goals.",
      ),
    owner: z
      .string()
      .optional()
      .describe(
        "Filter to goals owned by a specific user GID. Omit for all goals in the workspace.",
      ),
    workspace_gid: z
      .string()
      .optional()
      .describe("Workspace GID. Defaults to ASANA_DEFAULT_WORKSPACE_GID."),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const workspaceGid = resolveWorkspace(args?.workspace_gid);
    const today = todayISO(asanaTimezone);

    const opts: any = {
      opt_fields:
        "name,gid,permalink_url,owner.name,status,due_on,start_on,current_status_update.title,current_status_update.text,metric.current_display_value,metric.target_number,metric.current_number,metric.unit,time_period.display_name,is_workspace_level",
      limit: 100,
    };
    if (args?.time_period?.trim()) opts.time_periods = args.time_period.trim();

    let goals: any[] = [];
    try {
      const { data } = await client.getGoals(workspaceGid, opts);
      goals = data;
    } catch {
      goals = [];
    }

    if (args?.owner?.trim()) {
      const owner = args.owner.trim().toLowerCase();
      goals = goals.filter(
        (g: any) =>
          (g.owner?.name ?? "").toLowerCase().includes(owner) ||
          g.owner?.gid === args.owner?.trim(),
      );
    }

    if (goals.length === 0) {
      return userMessage(
        `No goals were found in this workspace${args?.time_period ? " for the requested time period" : ""}.

Tell the user this and note the possible reasons: goals may not be in use, may be scoped to a team rather than the workspace, or the access token may lack goal visibility.`,
      );
    }

    const rows = goals.map((g: any) => {
      const target = g.metric?.target_number ?? null;
      const current = g.metric?.current_number ?? null;
      const pctComplete =
        target !== null && current !== null && target !== 0
          ? Math.round((current / target) * 100)
          : null;

      // Time-elapsed vs progress is the signal that matters: a goal at 50%
      // is healthy at mid-period and alarming with a week to go.
      let pctElapsed: number | null = null;
      if (g.start_on && g.due_on) {
        const totalDays = diffDays(g.start_on, g.due_on);
        const usedDays = diffDays(g.start_on, today);
        if (totalDays > 0) {
          pctElapsed = Math.max(
            0,
            Math.min(100, Math.round((usedDays / totalDays) * 100)),
          );
        }
      }

      const pace =
        pctComplete !== null && pctElapsed !== null
          ? pctComplete - pctElapsed
          : null;

      return {
        name: g.name ?? "(unnamed goal)",
        url: g.permalink_url ?? null,
        owner: g.owner?.name ?? "Unowned",
        status: g.status ? (GOAL_STATUS[g.status] ?? g.status) : "No status",
        period: g.time_period?.display_name ?? null,
        due: g.due_on ?? null,
        metric: g.metric?.current_display_value ?? null,
        pctComplete,
        pctElapsed,
        pace,
        note: g.current_status_update?.text ?? null,
      };
    });

    const table = rows
      .map((r) => {
        const label = r.url ? `[${r.name}](${r.url})` : r.name;
        const prog = r.pctComplete === null ? "—" : `${r.pctComplete}%`;
        const elapsed = r.pctElapsed === null ? "—" : `${r.pctElapsed}%`;
        const paceLabel =
          r.pace === null
            ? "—"
            : r.pace >= 5
              ? `+${r.pace} ahead`
              : r.pace <= -5
                ? `${r.pace} behind`
                : "on pace";
        return `| ${label} | ${r.status} | ${prog} | ${elapsed} | ${paceLabel} | ${r.metric ?? "—"} | ${r.due ?? "—"} | ${r.owner} |`;
      })
      .join("\n");

    const behind = rows.filter((r) => r.pace !== null && r.pace <= -5);
    const noMetric = rows.filter((r) => r.pctComplete === null);

    const narratives = rows
      .filter((r) => r.note)
      .slice(0, 6)
      .map((r) => `  **${r.name}**: ${String(r.note).slice(0, 240)}`)
      .join("\n\n");

    return userMessage(
      `Assess progress against these Asana goals. All data is pre-fetched — do not re-fetch it.

## Goals (${rows.length})
| Goal | Status | Progress | Time elapsed | Pace | Metric | Due | Owner |
|---|---|---:|---:|---|---|---|---|
${table}

**Behind pace:** ${behind.length} · **No measurable metric:** ${noMetric.length}

## Latest Goal Updates
${narratives || "  No goals have a recent status narrative."}

---
Produce a goal progress report:

1. **Headline** — Are we going to hit our objectives? One sentence.

2. **Behind pace** — Goals where progress trails time elapsed by a meaningful margin. For each, say how far behind and what would have to change. The pace column is the key signal: 60% complete is good at the halfway mark and bad with two weeks left.

3. **On track or ahead** — Brief. Do not pad.

4. **Unmeasurable goals** — ${noMetric.length > 0 ? `${noMetric.length} goal(s) have no numeric metric, so progress cannot be verified objectively. Flag this — an unmeasurable goal cannot be managed.` : "All goals have measurable metrics."}

5. **Recommended actions** — Concrete next steps, each with an owner drawn from the table.

Judge pace, not just percentage. Call out any goal whose declared status contradicts its numbers (e.g. marked "On Track" while 30 points behind pace) — that is a reporting problem worth surfacing.`,
    );
  },
};
