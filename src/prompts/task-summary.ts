import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import type { PromptEntry } from "./types.js";

export const taskSummaryPrompt: PromptEntry = {
  name: "task-summary",
  description:
    "Get a comprehensive summary and status update for an Asana task. Pre-fetches task details, custom fields, and all comments — no additional tool calls required.",
  readOnly: true,
  argsSchema: {
    task_id: z.string().describe("The GID of the task to summarize"),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const taskId = args?.task_id;
    if (!taskId) {
      throw new Error("Task ID is required");
    }

    const [task, { data: stories }] = await Promise.all([
      client.getTask(taskId, {
        opt_fields:
          "name,notes,completed,assignee,assignee.name,due_on,projects,projects.name,tags,tags.name,num_subtasks,custom_fields,custom_fields.name,custom_fields.display_value",
      }),
      client.getStoriesForTask(taskId, {
        opt_fields: "text,created_at,created_by,created_by.name,type",
      }),
    ]);

    const statusLine = task.completed ? "Completed" : "In Progress";
    const assigneeLine = task.assignee?.name ?? "Unassigned";
    const dueLine = task.due_on
      ? `${task.due_on}${!task.completed && task.due_on < new Date().toISOString().slice(0, 10) ? " (OVERDUE)" : ""}`
      : "No due date";
    const projectsLine =
      task.projects?.map((p) => p.name ?? "").join(", ") || "None";
    const tagsLine = task.tags?.map((t) => t.name ?? "").join(", ") || "None";
    const subtasksLine =
      (task.num_subtasks ?? 0) > 0 ? String(task.num_subtasks) : "None";

    const customFieldsSection =
      task.custom_fields
        ?.filter((f) => f.display_value != null)
        .map((f) => `  ${f.name}: ${f.display_value}`)
        .join("\n") || "  None";

    // Only include comment stories, not system events
    const commentStories = stories.filter(
      (s: { type: string }) => s.type === "comment",
    );
    const activitySection =
      commentStories.length > 0
        ? commentStories
            .map(
              (s) =>
                `  [${new Date(s.created_at).toLocaleString()}] ${s.created_by?.name ?? "Unknown"}: ${s.text}`,
            )
            .join("\n\n")
        : "  No comments";

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Summarize this Asana task. All data is pre-fetched — do not call any additional tools.

## Task Details
- **Name:** ${task.name}
- **Status:** ${statusLine}
- **Assignee:** ${assigneeLine}
- **Due:** ${dueLine}
- **Projects:** ${projectsLine}
- **Tags:** ${tagsLine}
- **Subtasks:** ${subtasksLine}

## Notes
${task.notes || "No notes"}

## Custom Fields
${customFieldsSection}

## Comments (${commentStories.length})
${activitySection}

---
Structure your response as follows:
1. **Overview** — What this task is about and its current status
2. **Key Updates & Decisions** — Important information from the comments
3. **Blockers & Risks** — Overdue dates, missing assignees, unresolved questions, or dependencies
4. **Next Steps** — Concrete recommended actions`,
          },
        },
      ],
    };
  },
};
