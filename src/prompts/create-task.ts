import { z } from "zod";
import type { PromptEntry } from "./types.js";

export const createTaskPrompt: PromptEntry = {
  name: "create-task",
  description:
    "Interactively guide the creation of a comprehensive Asana task by collecting requirements through targeted questions, then create it using asana_create_task.",
  readOnly: false,
  argsSchema: {
    project_name: z
      .string()
      .describe(
        "The name of the Asana project where the task should be created",
      ),
    title: z.string().describe("The title of the task"),
    notes: z.string().optional().describe("Notes or description for the task"),
    due_date: z
      .string()
      .optional()
      .describe("Due date for the task (YYYY-MM-DD format)"),
  },
  handler: async (_client, args) => {
    const projectName = args?.project_name;
    const title = args?.title;

    if (!projectName) {
      throw new Error("Project name is required");
    }

    if (!title) {
      throw new Error("Task title is required");
    }

    const notes = args?.notes || "";
    const dueDate = args?.due_date;

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Help me create a well-structured Asana task. Ask targeted questions to gather all necessary information, then create the task using asana_create_task.

## Starting Details
- **Project:** ${projectName} (search for it by name to confirm and get its GID before creating)
- **Title:** ${title}${notes ? `\n- **Notes:** ${notes}` : ""}${dueDate ? `\n- **Due date:** ${dueDate}` : ""}

## Information to Collect
Before creating the task, ensure you have clarity on:

1. **Objective** — What is this task trying to achieve? How does it fit within the project?
2. **Deliverables** — What specific outputs are expected? What are the acceptance criteria?
3. **Scope** — What's included and what's explicitly out of scope?
4. **Requirements** — Technical specs, design guidelines, or constraints (as applicable to task type)
5. **Resources** — Skills, tool access, or collaborators required
6. **Timeline** — Is the due date firm? Are there milestones or blockers?
7. **Success criteria** — How will completion be verified? Who needs to approve?
8. **Dependencies** — Does this block or depend on other tasks?

Ask only about what's genuinely missing — skip questions that are obvious from context or already answered above.

## Task Creation
Once you have enough information, create the task with:
- A clear, action-oriented title
- A detailed description covering all requirements, organized with section headings
- A subtask checklist if the work has distinct steps
- Correct assignee, due date, and section placement
- Relevant tags or custom fields if applicable
`,
          },
        },
      ],
    };
  },
};
