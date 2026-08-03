import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import { asanaTimezone, resolveWorkspace } from "../config.js";
import { addDaysISO, diffDays, todayISO } from "../lib/dates.js";
import { formatResolveFailure, resolveProjectGid } from "../lib/resolve.js";
import type { PromptEntry } from "./types.js";

function userMessage(text: string): GetPromptResult {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

function parseDays(raw: unknown, def: number): number {
  if (typeof raw !== "string" || raw.trim() === "") return def;
  const n = Number.parseInt(raw.trim(), 10);
  if (Number.isNaN(n)) return def;
  return Math.min(365, Math.max(7, n));
}

export const staleTasksPrompt: PromptEntry = {
  name: "stale-tasks",
  description:
    "Find tasks that have had no activity for a long time and decide what to do with each: revive, reassign, reschedule, or close. The highest-return recurring cleanup — stale tasks quietly destroy the signal value of a backlog.",
  readOnly: true,
  argsSchema: {
    project: z
      .string()
      .optional()
      .describe(
        "Project to scan (name, URL, or GID). If omitted, scans tasks assigned to you across the workspace.",
      ),
    stale_days: z
      .string()
      .optional()
      .describe(
        "How many days without modification counts as stale (7–365, default 30).",
      ),
    workspace_gid: z
      .string()
      .optional()
      .describe("Workspace GID. Defaults to ASANA_DEFAULT_WORKSPACE_GID."),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const workspaceGid = resolveWorkspace(args?.workspace_gid);
    const staleDays = parseDays(args?.stale_days, 30);
    const today = todayISO(asanaTimezone);
    const cutoff = addDaysISO(today, -staleDays);

    const optFields =
      "name,permalink_url,completed,modified_at,created_at,due_on,assignee.name,notes,num_subtasks,memberships.section.name,projects.name";

    let tasks: any[] = [];
    let scopeLabel: string;

    if (args?.project?.trim()) {
      const resolved = await resolveProjectGid(
        client,
        args.project,
        workspaceGid,
      );
      if (!resolved.ok) {
        return userMessage(
          `Could not scan for stale tasks.\n\n${formatResolveFailure(resolved, "project")}`,
        );
      }
      const { data } = await client.getTasksForProject(resolved.gid, {
        opt_fields: optFields,
        limit: 100,
      });
      tasks = data;
      scopeLabel = `project **${resolved.name ?? resolved.gid}**`;
    } else {
      const { data } = await client.searchTasks(workspaceGid, {
        assignee_any: "me",
        completed: false,
        opt_fields: optFields,
      });
      tasks = data;
      scopeLabel = "your assigned tasks";
    }

    const stale = tasks
      .filter((t: any) => {
        if (t.completed) return false;
        const modified = (t.modified_at ?? t.created_at ?? "").slice(0, 10);
        return modified !== "" && modified < cutoff;
      })
      .map((t: any) => {
        const modified = (t.modified_at ?? t.created_at ?? "").slice(0, 10);
        return { ...t, idleDays: diffDays(modified, today), modified };
      })
      .sort((a, b) => b.idleDays - a.idleDays);

    if (stale.length === 0) {
      return userMessage(
        `No stale tasks found in ${scopeLabel} — nothing has been untouched for more than ${staleDays} days.

Tell the user their backlog is clean. If they want a stricter check, suggest re-running with a smaller \`stale_days\`.`,
      );
    }

    const bucket = (t: any) =>
      t.idleDays >= 180
        ? "Abandoned (6+ months)"
        : t.idleDays >= 90
          ? "Very stale (3–6 months)"
          : "Stale (1–3 months)";

    const groups = new Map<string, any[]>();
    for (const t of stale) {
      const key = bucket(t);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)?.push(t);
    }

    const order = [
      "Abandoned (6+ months)",
      "Very stale (3–6 months)",
      "Stale (1–3 months)",
    ];

    const sections = order
      .filter((k) => groups.has(k))
      .map((k) => {
        const list = groups.get(k) ?? [];
        const rows = list
          .slice(0, 25)
          .map((t: any) => {
            const label = t.permalink_url
              ? `[${t.name}](${t.permalink_url})`
              : t.name;
            const who = t.assignee?.name ?? "unassigned";
            const due = t.due_on
              ? ` · due ${t.due_on}${t.due_on < today ? " ⚠" : ""}`
              : " · no due date";
            const desc =
              !t.notes || t.notes.trim().length < 20 ? " · no description" : "";
            const sub =
              t.num_subtasks > 0 ? ` · ${t.num_subtasks} subtasks` : "";
            return `  - ${label} — idle ${t.idleDays}d · ${who}${due}${desc}${sub} · gid \`${t.gid}\``;
          })
          .join("\n");
        const more =
          list.length > 25 ? `\n  ...and ${list.length - 25} more` : "";
        return `### ${k} (${list.length})\n${rows}${more}`;
      })
      .join("\n\n");

    const unassigned = stale.filter((t: any) => !t.assignee).length;
    const noDue = stale.filter((t: any) => !t.due_on).length;

    return userMessage(
      `Triage the stale tasks in ${scopeLabel}. All data is pre-fetched — do not re-fetch it.

**${stale.length} task${stale.length === 1 ? "" : "s"} with no activity in over ${staleDays} days** (as of ${today})
- Unassigned: ${unassigned}
- No due date: ${noDue}

${sections}

---
For each stale task, recommend exactly one action and justify it in a few words:

- **Revive** — still valuable and should be worked soon. Say what it needs to get moving (an owner, a decision, a due date).
- **Reassign** — still valuable but the current owner clearly is not progressing it.
- **Reschedule** — valid work, unrealistic date. Propose a specific new date.
- **Close** — no longer valuable. Say why it is safe to drop.

Group your recommendations by action. Then give:

1. **The 3 highest-value revivals** — stale work that actually matters and is being quietly lost.
2. **Bulk close candidates** — items that can be closed together with little discussion, listed by GID so the user can act quickly.
3. **A pattern observation** — if the staleness clusters (one owner, one section, one age band), say so. That usually points at a process problem rather than individual tasks.

Note: age alone does not mean a task is worthless. A well-specified task with no activity may simply be correctly deprioritized — judge on content, not just idle days.`,
    );
  },
};
