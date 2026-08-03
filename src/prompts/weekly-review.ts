import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import { resolveWorkspace } from "../config.js";
import type { PromptEntry } from "./types.js";
import { todayISO } from "./types.js";

export const weeklyReviewPrompt: PromptEntry = {
  name: "weekly-review",
  description:
    "Generate a weekly review by fetching tasks completed this week and your current open tasks. Produces a reflection on the past week and a plan for the next.",
  readOnly: true,
  argsSchema: {
    workspace_gid: z
      .string()
      .optional()
      .describe(
        "Workspace GID to search in (defaults to ASANA_DEFAULT_WORKSPACE_GID)",
      ),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const workspaceGid = resolveWorkspace(args?.workspace_gid);
    const today = todayISO();
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const [{ data: completed }, { data: open }] = await Promise.all([
      client.searchTasks(workspaceGid, {
        assignee_any: "me",
        completed: true,
        completed_on_after: oneWeekAgo,
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
      completed_at?: string;
      projects?: { name?: string }[];
    }) => {
      const project =
        t.projects
          ?.map((p) => p.name ?? "")
          .filter(Boolean)
          .join(", ") || "No project";
      return `  - ${t.name} [${project}]`;
    };

    const overdue = open.filter(
      (t: { due_on?: string | null }) => t.due_on && t.due_on < today,
    );
    const dueNextWeek = open.filter(
      (t: { due_on?: string | null }) =>
        t.due_on && t.due_on >= today && t.due_on <= nextWeek,
    );
    const later = open.filter(
      (t: { due_on?: string | null }) => !t.due_on || t.due_on > nextWeek,
    );

    // Group completed by project
    const byProject = new Map<string, string[]>();
    for (const t of completed) {
      const project =
        t.projects
          ?.map((p: { name?: string }) => p.name ?? "")
          .filter(Boolean)
          .join(", ") || "No project";
      const names = byProject.get(project) ?? [];
      names.push(t.name);
      byProject.set(project, names);
    }

    const completedSection =
      completed.length > 0
        ? [...byProject.entries()]
            .map(
              ([proj, names]) =>
                `  **${proj}**\n${names.map((n) => `    - ${n}`).join("\n")}`,
            )
            .join("\n\n")
        : "  Nothing completed this week";

    const upcomingSection =
      dueNextWeek.length > 0
        ? dueNextWeek.map(formatTask).join("\n")
        : "  Nothing due next week";

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Help me do my weekly review. All data is pre-fetched \u2014 do not call any additional tools.

## Completed This Week (${completed.length} tasks)
${completedSection}

## Currently Open (${open.length} tasks)
### Overdue (${overdue.length})
${overdue.length > 0 ? overdue.map(formatTask).join("\n") : "  None"}

### Due Next 7 Days (${dueNextWeek.length})
${upcomingSection}

### Later / No Due Date (${later.length})
${later.length > 0 ? later.slice(0, 15).map(formatTask).join("\n") + (later.length > 15 ? `\n  ... and ${later.length - 15} more` : "") : "  None"}

---
Structure the review as follows:

**What got done this week:**
[Highlight the most meaningful completions. Group by theme or project. Note anything that slipped from last week's plan.]

**Wins & learnings:**
[1\u20133 things that went well or that you learned this week.]

**Next week's focus:**
[Top 3\u20135 priorities for next week based on overdue items and upcoming due dates. Be specific.]

**Actions needed:**
[Any tasks that need reassignment, rescheduling, or follow-up before next week starts.]`,
          },
        },
      ],
    };
  },
};
