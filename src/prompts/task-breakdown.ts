import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import type { PromptEntry } from "./types.js";

export const taskBreakdownPrompt: PromptEntry = {
  name: "task-breakdown",
  description:
    "Break a complex Asana task into well-scoped subtasks. Pre-fetches the task and existing subtasks, then guides creation of a complete subtask checklist.",
  readOnly: false,
  argsSchema: {
    task_id: z.string().describe("The GID or URL of the task to break down"),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const taskId = args?.task_id;
    if (!taskId) throw new Error("Task ID is required");

    // Extract GID if URL provided
    const gid = taskId.includes("/")
      ? (taskId.split("/").filter(Boolean).pop() ?? taskId)
      : taskId;

    const [task, { data: existingSubtasks }] = await Promise.all([
      client.getTask(gid, {
        opt_fields:
          "name,notes,assignee,assignee.name,due_on,projects,projects.name,num_subtasks",
      }),
      client.getSubtasksForTask(gid, {
        opt_fields: "name,completed,assignee,assignee.name",
      }),
    ]);

    const existingSection =
      existingSubtasks.length > 0
        ? existingSubtasks
            .map(
              (s: {
                name: string;
                completed?: boolean;
                assignee?: { name?: string } | null;
              }) =>
                `  - [${s.completed ? "x" : " "}] ${s.name}${s.assignee?.name ? ` (${s.assignee.name})` : ""}`,
            )
            .join("\n")
        : "  None";

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Break this Asana task into well-scoped subtasks, then create them.

## Task
- **Name:** ${task.name}
- **Assignee:** ${task.assignee?.name ?? "Unassigned"}
- **Due:** ${task.due_on ?? "No due date"}
- **Projects:** ${task.projects?.map((p: { name?: string }) => p.name ?? "").join(", ") || "None"}

## Description
${task.notes || "No description"}

## Existing Subtasks (${existingSubtasks.length})
${existingSection}

---
## Process

1. **Analyze the task** — Understand the full scope of work based on the name and description.

2. **Ask clarifying questions** if needed — before creating anything, identify any critical unknowns that would affect how to break down the work. Skip questions where the answer is obvious from context.

3. **Design the subtask breakdown:**
   - Each subtask should be independently actionable (someone can pick it up and do it without needing to ask)
   - Each subtask should be completable in 1–2 days of work maximum
   - Name each subtask with a clear verb ("Implement X", "Review Y", "Write Z")
   - Aim for 3–10 subtasks — avoid over-fragmenting or under-specifying
   - Don't duplicate existing subtasks

4. **Create the subtasks** using asana_create_subtask (parent_task_id: ${gid}):
   - Set the subtask name
   - Optionally add a short description if the subtask needs context
   - Assign to the appropriate person if clear from context

5. **Confirm** by listing all created subtasks at the end.`,
          },
        },
      ],
    };
  },
};
