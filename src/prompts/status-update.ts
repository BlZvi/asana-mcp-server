import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import type { PromptEntry } from "./types.js";
import { todayISO } from "./types.js";

export const statusUpdatePrompt: PromptEntry = {
  name: "status-update",
  description:
    "Generate a polished stakeholder status update (email/Slack format) for an Asana project. Pre-fetches project data \u2014 no additional tool calls required.",
  readOnly: true,
  argsSchema: {
    project_id: z.string().describe("The GID of the project"),
    audience: z
      .string()
      .optional()
      .describe(
        "Target audience: executive, team, or client (default: team). Affects tone and level of detail.",
      ),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const projectId = args?.project_id;
    if (!projectId) throw new Error("Project ID is required");

    const audience = args?.audience ?? "team";

    const [project, taskCounts, { data: statuses }, { data: tasks }] =
      await Promise.all([
        client.getProject(projectId, {
          opt_fields:
            "name,notes,owner,owner.name,due_date,start_on,team,team.name,current_status,current_status.color,current_status.title",
        }),
        client.getProjectTaskCounts(projectId, {
          opt_fields:
            "num_tasks,num_completed_tasks,num_incomplete_tasks,num_milestones,num_incomplete_milestones",
        }),
        client.getProjectStatusesForProject(projectId, {
          opt_fields: "text,color,title,author,author.name,created_at",
          limit: 3,
        }),
        client.getTasksForProject(projectId, {
          opt_fields: "name,completed,assignee,assignee.name,due_on",
          limit: 50,
        }),
      ]);

    const total = taskCounts.num_tasks ?? 0;
    const completed = taskCounts.num_completed_tasks ?? 0;
    const progress =
      total > 0 ? `${Math.round((completed / total) * 100)}%` : "N/A";

    const today = todayISO();
    const incompleteTasks = tasks.filter(
      (t: { completed?: boolean }) => !t.completed,
    );
    const overdueTasks = incompleteTasks.filter(
      (t: { due_on?: string | null }) => t.due_on && t.due_on < today,
    );

    const statusColors: Record<string, string> = {
      green: "On Track",
      yellow: "At Risk",
      red: "Off Track",
      blue: "On Hold",
    };

    const latestStatus = statuses[0];
    const overallHealth = latestStatus?.color
      ? (statusColors[latestStatus.color] ?? latestStatus.color)
      : progress === "N/A"
        ? "Unknown"
        : Number.parseInt(progress, 10) >= 75
          ? "On Track"
          : Number.parseInt(progress, 10) >= 40
            ? "In Progress"
            : "Early Stage";

    const recentUpdatesSection =
      statuses.length > 0
        ? statuses
            .map((s) => {
              const date = s.created_at
                ? new Date(s.created_at).toLocaleDateString()
                : "";
              const label = s.color ? (statusColors[s.color] ?? s.color) : "";
              return `  [${[date, s.title, label].filter(Boolean).join(" \u00b7 ")}]\n  ${s.text}`;
            })
            .join("\n\n")
        : "  No recent status updates";

    const audienceInstructions: Record<string, string> = {
      executive:
        "Write for senior leadership. Lead with the headline (status + key number). Use 3\u20135 bullet points max. Skip task-level detail. Focus on business impact, risks, and decisions needed. Avoid jargon.",
      team: "Write for the project team. Be direct and specific. Include what's done, what's in flight, and what's blocked. A short paragraph followed by bullets works well.",
      client:
        "Write for an external client. Use a professional, positive tone. Lead with progress and milestones. Mention risks only with mitigation context. Avoid internal process details.",
    };

    const audienceGuide =
      audienceInstructions[audience] ?? audienceInstructions.team;

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Write a status update for this Asana project. All data is pre-fetched \u2014 do not call any additional tools.

## Project: ${project.name}
- **Overall health:** ${overallHealth}
- **Progress:** ${progress} complete (${completed} of ${total} tasks)
- **Overdue tasks:** ${overdueTasks.length}
- **Incomplete milestones:** ${taskCounts.num_incomplete_milestones ?? 0} of ${taskCounts.num_milestones ?? 0}${project.due_date ? `\n- **Project due:** ${project.due_date}` : ""}

## Recent Status Updates
${recentUpdatesSection}

---
**Audience:** ${audience}

${audienceGuide}

Format the update as a ready-to-send message \u2014 no meta-commentary, no "here is your update" framing. Just the update itself.`,
          },
        },
      ],
    };
  },
};
