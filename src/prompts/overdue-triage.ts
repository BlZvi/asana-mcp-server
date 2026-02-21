import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import type { PromptEntry } from "./types.js";

export const overdueTriagePrompt: PromptEntry = {
  name: "overdue-triage",
  description:
    "Fetch all overdue tasks in a project and help triage them: do now, reschedule, reassign, or drop. Pre-fetches task data — no additional tool calls required.",
  readOnly: true,
  argsSchema: {
    project_id: z.string().describe("The GID of the project to triage"),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const projectId = args?.project_id;
    if (!projectId) throw new Error("Project ID is required");

    const today = new Date().toISOString().slice(0, 10);

    const [project, { data: tasks }] = await Promise.all([
      client.getProject(projectId, {
        opt_fields: "name,owner,owner.name",
      }),
      client.getTasksForProject(projectId, {
        opt_fields:
          "name,completed,assignee,assignee.name,due_on,notes,num_subtasks",
        limit: 100,
      }),
    ]);

    const overdueTasks = tasks
      .filter(
        (t: { completed?: boolean; due_on?: string | null }) =>
          !t.completed && t.due_on && t.due_on < today,
      )
      .sort(
        (
          a: { due_on?: string | null },
          b: { due_on?: string | null },
        ) => (a.due_on ?? "").localeCompare(b.due_on ?? ""),
      );

    if (overdueTasks.length === 0) {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Good news — project "${project.name}" has no overdue tasks today (${today}).`,
            },
          },
        ],
      };
    }

    const severity = (dueOn: string) => {
      const days = Math.round(
        (new Date(today).getTime() - new Date(dueOn).getTime()) /
          (1000 * 60 * 60 * 24),
      );
      if (days >= 14) return `${days}d overdue ⚠⚠⚠`;
      if (days >= 7) return `${days}d overdue ⚠⚠`;
      return `${days}d overdue ⚠`;
    };

    const taskList = overdueTasks
      .map(
        (t: {
          name: string;
          due_on?: string | null;
          assignee?: { name?: string } | null;
          notes?: string | null;
          num_subtasks?: number;
        }) => {
          const lines = [
            `  - **${t.name}**`,
            `    Assignee: ${t.assignee?.name ?? "Unassigned"} | ${severity(t.due_on!)} (was due ${t.due_on})`,
          ];
          if (t.num_subtasks && t.num_subtasks > 0) {
            lines.push(`    Subtasks: ${t.num_subtasks}`);
          }
          if (t.notes) {
            const preview = t.notes.slice(0, 100).replace(/\n/g, " ");
            lines.push(`    Notes: ${preview}${t.notes.length > 100 ? "..." : ""}`);
          }
          return lines.join("\n");
        },
      )
      .join("\n\n");

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Triage the overdue tasks in this project. All data is pre-fetched — do not call any additional tools.\n\n## Project: ${project.name}\n**${overdueTasks.length} overdue task${overdueTasks.length !== 1 ? "s" : ""} as of ${today}**\n\n${taskList}\n\n---\nFor each overdue task, recommend one of these actions and briefly explain why:\n\n- **Do now** — High priority, must be completed ASAP; possibly blocking others\n- **Reschedule** — Still relevant but due date needs updating; suggest a realistic new date\n- **Reassign** — Current assignee is blocked or wrong person; suggest who should own it\n- **Drop / close** — No longer relevant or valuable; safe to mark complete or delete\n\nGroup your recommendations by action type. For "Reschedule" items, always suggest a specific new date. For "Reassign" items, note what information you'd need to know the right assignee.\n\nEnd with a summary: total counts by action, and the top 3 tasks that need immediate attention.`,
          },
        },
      ],
    };
  },
};
