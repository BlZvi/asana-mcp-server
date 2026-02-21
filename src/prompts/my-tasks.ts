import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import { resolveWorkspace } from "../config.js";
import type { PromptEntry } from "./types.js";

export const myTasksPrompt: PromptEntry = {
  name: "my-tasks",
  description:
    "Fetch all incomplete tasks assigned to you and generate a prioritized daily work plan. Optionally scoped to a specific workspace.",
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
    const today = new Date().toISOString().slice(0, 10);
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const { data: tasks } = await client.searchTasks(workspaceGid, {
      assignee_any: "me",
      completed: false,
      sort_by: "due_date",
      sort_ascending: true,
      opt_fields: "name,due_on,projects,projects.name,assignee_status",
    });

    const overdue = tasks.filter(
      (t: { due_on?: string }) => t.due_on && t.due_on < today,
    );
    const dueToday = tasks.filter(
      (t: { due_on?: string }) => t.due_on === today,
    );
    const dueThisWeek = tasks.filter(
      (t: { due_on?: string }) =>
        t.due_on && t.due_on > today && t.due_on <= nextWeek,
    );
    const later = tasks.filter(
      (t: { due_on?: string }) => !t.due_on || t.due_on > nextWeek,
    );

    const formatTask = (t: { name: string; due_on?: string; projects?: { name?: string }[] }) => {
      const project =
        t.projects?.map((p) => p.name ?? "").filter(Boolean).join(", ") ||
        "No project";
      return `  - ${t.name} [${project}]${t.due_on ? ` · due ${t.due_on}` : ""}`;
    };

    const section = (label: string, list: typeof tasks) =>
      `### ${label} (${list.length})\n${list.length > 0 ? list.map(formatTask).join("\n") : "  None"}`;

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Review my Asana task list and help me plan my day. All data is pre-fetched — do not call any additional tools.

## My Open Tasks (${tasks.length} total)

${section("Overdue", overdue)}

${section("Due Today", dueToday)}

${section("Due This Week", dueThisWeek)}

${section("Later / No Due Date", later)}

---
Based on this list:
1. **Priority Focus** — The 3–5 most important tasks to tackle today, and why
2. **Overdue Action** — How to address each overdue item (do it now / reschedule / escalate)
3. **Suggested Order** — Recommended sequence to work through today's tasks
4. **Flags** — Anything that looks blocked, under-specified, or worth rescheduling`,
          },
        },
      ],
    };
  },
};
