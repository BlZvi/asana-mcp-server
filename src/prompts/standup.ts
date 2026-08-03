import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import { resolveWorkspace } from "../config.js";
import type { PromptEntry } from "./types.js";
import { todayISO } from "./types.js";

export const standupPrompt: PromptEntry = {
  name: "standup",
  description:
    "Generate standup notes by fetching tasks you completed recently and tasks currently assigned to you. Produces a done/doing/blockers summary.",
  readOnly: true,
  argsSchema: {
    workspace_gid: z
      .string()
      .optional()
      .describe(
        "Workspace GID to search in (defaults to ASANA_DEFAULT_WORKSPACE_GID)",
      ),
    days_back: z
      .string()
      .optional()
      .describe(
        "How many days back to look for completed tasks (default: 1). Use 3 for post-weekend standups.",
      ),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const workspaceGid = resolveWorkspace(args?.workspace_gid);
    const daysBack = Math.max(1, Number.parseInt(args?.days_back ?? "1", 10));
    const sinceDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const today = todayISO();

    const [{ data: completed }, { data: inProgress }] = await Promise.all([
      client.searchTasks(workspaceGid, {
        assignee_any: "me",
        completed: true,
        completed_on_after: sinceDate,
        opt_fields: "name,completed_at,projects,projects.name",
      }),
      client.searchTasks(workspaceGid, {
        assignee_any: "me",
        completed: false,
        sort_by: "due_date",
        sort_ascending: true,
        opt_fields: "name,due_on,projects,projects.name",
      }),
    ]);

    const formatTask = (t: {
      name: string;
      due_on?: string;
      projects?: { name?: string }[];
    }) => {
      const project =
        t.projects
          ?.map((p) => p.name ?? "")
          .filter(Boolean)
          .join(", ") || "No project";
      return `  - ${t.name} [${project}]`;
    };

    const overdue = inProgress.filter(
      (t: { due_on?: string }) => t.due_on && t.due_on < today,
    );

    const completedSection =
      completed.length > 0
        ? completed.map(formatTask).join("\n")
        : "  Nothing completed in this period";

    const inProgressSection =
      inProgress.length > 0
        ? inProgress
            .slice(0, 25)
            .map(
              (t: {
                name: string;
                due_on?: string;
                projects?: { name?: string }[];
              }) => {
                const project =
                  t.projects
                    ?.map((p: { name?: string }) => p.name ?? "")
                    .filter(Boolean)
                    .join(", ") || "No project";
                const dueTag =
                  t.due_on === today
                    ? " · due today"
                    : t.due_on && t.due_on < today
                      ? ` · overdue (${t.due_on})`
                      : t.due_on
                        ? ` · due ${t.due_on}`
                        : "";
                return `  - ${t.name} [${project}]${dueTag}`;
              },
            )
            .join("\n") +
          (inProgress.length > 25
            ? `\n  ... and ${inProgress.length - 25} more`
            : "")
        : "  No open tasks";

    const overdueSection =
      overdue.length > 0
        ? overdue
            .map(
              (t: { name: string; due_on?: string }) =>
                `  - ${t.name} (was due ${t.due_on})`,
            )
            .join("\n")
        : "  None";

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Generate my standup notes from Asana. All data is pre-fetched — do not call any additional tools.

## Completed (last ${daysBack} day${daysBack !== 1 ? "s" : ""}, ${completed.length} tasks)
${completedSection}

## In Progress / Up Next (${inProgress.length} total)
${inProgressSection}

## Overdue (${overdue.length})
${overdueSection}

---
Write concise standup notes in this format:

**Done:**
[Bullet list of completed work. Group by theme or project if there are multiple items.]

**Today:**
[Bullet list of planned tasks — focus on what will actually be worked on today, not the full backlog.]

**Blockers:**
[Any overdue items, blockers, or risks — or "None" if the path is clear.]

Keep it brief and professional. A standup should take under 2 minutes to read aloud.`,
          },
        },
      ],
    };
  },
};
