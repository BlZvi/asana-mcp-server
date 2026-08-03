import { z } from "zod";
import type { PromptEntry } from "./types.js";
import { todayISO } from "./types.js";

export const logWorkPrompt: PromptEntry = {
  name: "log-work",
  description:
    "Document work that was done outside Asana (ad-hoc, urgent, or support tasks). Searches for the project, creates a task with full context, and marks it complete. Useful for retro-logging.",
  readOnly: false,
  argsSchema: {
    project_name: z
      .string()
      .describe("Name of the Asana project to log the work under"),
    description: z
      .string()
      .describe("What was done — be as specific as possible"),
    date: z
      .string()
      .optional()
      .describe(
        "When the work was done (YYYY-MM-DD, defaults to today). Used as the task's completion date.",
      ),
    duration_minutes: z
      .string()
      .optional()
      .describe("Approximate time spent in minutes (optional)"),
    requester: z
      .string()
      .optional()
      .describe(
        "Who asked for this work or why it was urgent (optional, adds context to the task)",
      ),
  },
  handler: async (_client, args) => {
    const projectName = args?.project_name;
    const description = args?.description;

    if (!projectName) throw new Error("Project name is required");
    if (!description) throw new Error("Description is required");

    const date = args?.date ?? todayISO();
    const duration = args?.duration_minutes;
    const requester = args?.requester;

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Log work that was done outside of Asana by creating and immediately completing a task.

## Work to Log
- **Project:** ${projectName}
- **Date completed:** ${date}
- **What was done:** ${description}${duration ? `\n- **Time spent:** ~${duration} minutes` : ""}${requester ? `\n- **Requested by / context:** ${requester}` : ""}

## Steps
1. Search for the project by name using asana_search_projects to get its GID
2. Create the task using asana_create_task with:
   - A concise, descriptive title (derive from the description above)
   - A detailed description including: what was done, why, any outcomes or decisions, and any follow-up needed
   - The correct project GID
   - Due date set to the completion date (${date})
3. Immediately mark the task complete using asana_update_task with \`completed: true\`

## Task Description Format
Write the task description so it's useful as a record. Include:
- **What:** Specific action taken
- **Why / Context:** What prompted this work${requester ? ` (requested by ${requester})` : ""}
- **Outcome:** What was delivered or resolved
- **Follow-up:** Any open items that need tracking (if applicable)
${duration ? `- **Time logged:** ~${duration} minutes` : ""}

The goal is an accurate historical record that anyone on the team could read and understand.`,
          },
        },
      ],
    };
  },
};
