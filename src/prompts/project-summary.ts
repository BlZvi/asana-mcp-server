import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import type { PromptEntry } from "./types.js";
import { todayISO } from "./types.js";

export const projectSummaryPrompt: PromptEntry = {
  name: "project-summary",
  description:
    "Generate a project status report for an Asana project. Pre-fetches project metadata, task counts, recent status updates, and open tasks — no additional tool calls required.",
  readOnly: true,
  argsSchema: {
    project_id: z.string().describe("The GID of the project to summarize"),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const projectId = args?.project_id;
    if (!projectId) {
      throw new Error("Project ID is required");
    }

    const [project, taskCounts, { data: statuses }, { data: tasks }] =
      await Promise.all([
        client.getProject(projectId, {
          opt_fields:
            "name,notes,owner,owner.name,color,archived,due_date,start_on,team,team.name,current_status,current_status.text,current_status.color,current_status.title,current_status.author,current_status.author.name",
        }),
        client.getProjectTaskCounts(projectId, {
          opt_fields:
            "num_tasks,num_completed_tasks,num_incomplete_tasks,num_milestones,num_incomplete_milestones",
        }),
        client.getProjectStatusesForProject(projectId, {
          opt_fields: "text,color,title,author,author.name,created_at",
          limit: 5,
        }),
        client.getTasksForProject(projectId, {
          opt_fields: "name,completed,assignee,assignee.name,due_on",
          limit: 50,
        }),
      ]);

    const total = taskCounts.num_tasks ?? 0;
    const completed = taskCounts.num_completed_tasks ?? 0;
    const incomplete = taskCounts.num_incomplete_tasks ?? 0;
    const progress =
      total > 0 ? `${Math.round((completed / total) * 100)}%` : "N/A";

    const milestonesLine =
      taskCounts.num_milestones > 0
        ? `${taskCounts.num_incomplete_milestones} of ${taskCounts.num_milestones} milestones remaining`
        : "No milestones";

    const statusColors: Record<string, string> = {
      green: "On Track",
      yellow: "At Risk",
      red: "Off Track",
      blue: "On Hold",
    };

    const recentStatusSection =
      statuses.length > 0
        ? statuses
            .map((s) => {
              const colorLabel = s.color
                ? (statusColors[s.color] ?? s.color)
                : "";
              const header = [
                s.created_at
                  ? new Date(s.created_at).toLocaleDateString()
                  : null,
                s.title,
                colorLabel,
                s.author?.name,
              ]
                .filter(Boolean)
                .join(" · ");
              return `  [${header}]\n  ${s.text}`;
            })
            .join("\n\n")
        : "  No status updates yet";

    const today = todayISO();
    const incompleteTasks = tasks.filter((t) => !t.completed);
    const overdueTasks = incompleteTasks.filter(
      (t) => t.due_on && t.due_on < today,
    );
    const unassignedTasks = incompleteTasks.filter((t) => !t.assignee);

    const taskListSection =
      incompleteTasks.length > 0
        ? incompleteTasks
            .slice(0, 20)
            .map((t) => {
              const parts = [];
              if (t.assignee?.name) parts.push(t.assignee.name);
              else parts.push("Unassigned");
              if (t.due_on) {
                const overdue = t.due_on < today ? " ⚠ overdue" : "";
                parts.push(`due ${t.due_on}${overdue}`);
              }
              return `  - ${t.name} (${parts.join(", ")})`;
            })
            .join("\n") +
          (incompleteTasks.length > 20
            ? `\n  ... and ${incompleteTasks.length - 20} more`
            : "")
        : "  All tasks completed!";

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Generate a project status report for the following Asana project data. All data is pre-fetched — do not call any additional tools.

## Project
- **Name:** ${project.name}
- **Owner:** ${project.owner?.name ?? "None"}
- **Team:** ${project.team?.name ?? "None"}
- **Status:** ${project.archived ? "Archived" : "Active"}${project.start_on ? `\n- **Start:** ${project.start_on}` : ""}${project.due_date ? `\n- **Due:** ${project.due_date}` : ""}

## Task Progress
- **Total:** ${total} tasks (${progress} complete)
- **Completed:** ${completed} | **Incomplete:** ${incomplete}
- **Milestones:** ${milestonesLine}
- **Overdue:** ${overdueTasks.length} | **Unassigned:** ${unassignedTasks.length}

## Project Notes
${project.notes || "No notes"}

## Recent Status Updates (last ${statuses.length})
${recentStatusSection}

## Open Tasks (${incompleteTasks.length} total, showing up to 20)
${taskListSection}

---
Structure your report as follows:
1. **Executive Summary** — Overall health, completion percentage, and current trajectory
2. **Accomplishments** — What's on track or recently completed
3. **Risks & Blockers** — Overdue tasks (${overdueTasks.length}), unassigned tasks (${unassignedTasks.length}), and concerns from status updates
4. **Recommended Actions** — Specific next steps or decisions needed`,
          },
        },
      ],
    };
  },
};
