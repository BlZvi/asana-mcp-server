import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import type { PromptEntry } from "./types.js";

export const teamWorkloadPrompt: PromptEntry = {
  name: "team-workload",
  description:
    "Analyze task distribution across team members in an Asana project to identify workload imbalances, overloaded members, and unassigned work.",
  readOnly: true,
  argsSchema: {
    project_id: z
      .string()
      .describe("The GID of the project to analyze"),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const projectId = args?.project_id;
    if (!projectId) throw new Error("Project ID is required");

    const [project, { data: tasks }] = await Promise.all([
      client.getProject(projectId, {
        opt_fields: "name,team,team.name,owner,owner.name",
      }),
      client.getTasksForProject(projectId, {
        opt_fields: "name,completed,assignee,assignee.name,assignee.gid,due_on",
        limit: 100,
      }),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const incompleteTasks = tasks.filter(
      (t: { completed?: boolean }) => !t.completed,
    );

    type MemberEntry = { name: string; tasks: typeof incompleteTasks; overdue: number };
    const byAssignee = new Map<string, MemberEntry>();
    byAssignee.set("unassigned", { name: "Unassigned", tasks: [], overdue: 0 });

    for (const task of incompleteTasks) {
      const key: string = task.assignee?.gid ?? "unassigned";
      const name: string = task.assignee?.name ?? "Unassigned";
      if (!byAssignee.has(key)) {
        byAssignee.set(key, { name, tasks: [], overdue: 0 });
      }
      const entry = byAssignee.get(key)!;
      entry.tasks.push(task);
      if (task.due_on && task.due_on < today) entry.overdue++;
    }

    const sorted = [...byAssignee.entries()].sort(
      (a, b) => b[1].tasks.length - a[1].tasks.length,
    );

    const membersWithTasks = sorted.filter(
      ([k, { tasks: mt }]) => k !== "unassigned" && mt.length > 0,
    );
    const unassignedEntry = byAssignee.get("unassigned")!;

    const workloadSection = sorted
      .filter(([, { tasks: mt }]) => mt.length > 0)
      .map(([, { name, tasks: memberTasks, overdue }]) => {
        const lines = [
          `  **${name}** — ${memberTasks.length} task${memberTasks.length !== 1 ? "s" : ""} (${overdue} overdue)`,
        ];
        for (const t of memberTasks.slice(0, 5)) {
          const due = t.due_on
            ? ` · due ${t.due_on}${t.due_on < today ? " ⚠" : ""}`
            : "";
          lines.push(`    - ${t.name}${due}`);
        }
        if (memberTasks.length > 5) {
          lines.push(`    ... and ${memberTasks.length - 5} more`);
        }
        return lines.join("\n");
      })
      .join("\n\n");

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Analyze team workload for this Asana project. All data is pre-fetched — do not call any additional tools.

## Project: ${project.name}${project.team?.name ? ` · Team: ${project.team.name}` : ""}${project.owner?.name ? ` · Owner: ${project.owner.name}` : ""}
- **Total incomplete tasks:** ${incompleteTasks.length}
- **Team members with tasks:** ${membersWithTasks.length}
- **Unassigned tasks:** ${unassignedEntry.tasks.length}

## Workload by Person
${workloadSection || "  No tasks currently assigned"}

---
Analyze this workload and provide:
1. **Distribution Summary** — Is the load balanced? Who carries the most and least?
2. **Risk Flags** — Who has overdue tasks or an unsustainable number of open items?
3. **Unassigned Work** — How urgent is it to assign the ${unassignedEntry.tasks.length} unassigned task${unassignedEntry.tasks.length !== 1 ? "s" : ""}?
4. **Recommendations** — Specific actions to rebalance load (who should take what, what should be deprioritized)`,
          },
        },
      ],
    };
  },
};
