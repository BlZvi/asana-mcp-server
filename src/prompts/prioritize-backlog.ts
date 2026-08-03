import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import type { PromptEntry } from "./types.js";
import { todayISO } from "./types.js";

export const prioritizeBacklogPrompt: PromptEntry = {
  name: "prioritize-backlog",
  description:
    "Fetch all incomplete tasks in a project and guide prioritization. Organizes by section, surfaces unprioritized items, and asks targeted questions to help rank work.",
  readOnly: true,
  argsSchema: {
    project_id: z.string().describe("The GID of the project to prioritize"),
    focus: z
      .string()
      .optional()
      .describe(
        "Optional context to guide prioritization (e.g. 'next sprint', 'quick wins', 'unblock the team')",
      ),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const projectId = args?.project_id;
    if (!projectId) throw new Error("Project ID is required");

    const focus = args?.focus;
    const today = todayISO();

    const [project, { data: sections }, { data: tasks }] = await Promise.all([
      client.getProject(projectId, {
        opt_fields: "name,due_date",
      }),
      client.getProjectSections(projectId, {
        opt_fields: "name",
      }),
      client.getTasksForProject(projectId, {
        opt_fields:
          "name,completed,assignee,assignee.name,due_on,notes,memberships,memberships.section,memberships.section.gid,memberships.section.name",
        limit: 100,
      }),
    ]);

    const incompleteTasks = tasks.filter(
      (t: { completed?: boolean }) => !t.completed,
    );
    const overdue = incompleteTasks.filter(
      (t: { due_on?: string | null }) => t.due_on && t.due_on < today,
    );
    const noDueDate = incompleteTasks.filter(
      (t: { due_on?: string | null }) => !t.due_on,
    );
    const noAssignee = incompleteTasks.filter(
      (t: { assignee?: unknown }) => !t.assignee,
    );

    // Group by section
    const sectionMap = new Map<
      string,
      { name: string; tasks: typeof incompleteTasks }
    >();
    for (const section of sections) {
      sectionMap.set(section.gid, { name: section.name, tasks: [] });
    }
    const noSection = {
      name: "No Section",
      tasks: [] as typeof incompleteTasks,
    };
    sectionMap.set("none", noSection);

    for (const task of incompleteTasks) {
      const sectionGid = task.memberships?.[0]?.section?.gid ?? "none";
      const entry = sectionMap.get(sectionGid) ?? noSection;
      entry.tasks.push(task);
    }

    const sectionList = [...sectionMap.entries()]
      .filter(([, { tasks: st }]) => st.length > 0)
      .map(([, { name, tasks: st }]) => {
        const taskLines = st
          .slice(0, 10)
          .map(
            (t: {
              name: string;
              due_on?: string | null;
              assignee?: { name?: string } | null;
            }) => {
              const due = t.due_on
                ? ` · due ${t.due_on}${t.due_on < today ? " ⚠" : ""}`
                : " · no due date";
              const who = t.assignee?.name
                ? ` · ${t.assignee.name}`
                : " · unassigned";
              return `    - ${t.name}${due}${who}`;
            },
          )
          .join("\n");
        const more =
          st.length > 10 ? `\n    ... and ${st.length - 10} more` : "";
        return `  **${name}** (${st.length} tasks)\n${taskLines}${more}`;
      })
      .join("\n\n");

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Help me prioritize this project backlog. All data is pre-fetched — do not call any additional tools.\n\n## Project: ${project.name}${project.due_date ? ` · Due: ${project.due_date}` : ""}\n- **Total incomplete tasks:** ${incompleteTasks.length}\n- **Overdue:** ${overdue.length}\n- **No due date:** ${noDueDate.length}\n- **Unassigned:** ${noAssignee.length}\n${focus ? `- **Prioritization focus:** ${focus}` : ""}\n\n## Backlog by Section\n${sectionList || "  No tasks found"}\n\n---\nHelp prioritize this backlog using the following approach:\n\n1. **Ask 2–3 targeted questions** to understand what matters most right now — business value, deadlines, dependencies, team capacity. Skip questions where the answer is obvious from the data.\n\n2. **Once you have enough context**, produce a prioritized list:\n   - **P1 — Do this sprint / this week** (must-do, high impact or blocking)\n   - **P2 — Do next** (important but not urgent)\n   - **P3 — Backlog** (lower priority, do when capacity allows)\n   - **P4 — Consider dropping** (low value or stale)\n\n3. **Flag** tasks that need more information before they can be prioritized.\n\nBe specific — avoid "it depends" without following up with what it depends on.`,
          },
        },
      ],
    };
  },
};
