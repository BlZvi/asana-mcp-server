import { z } from "zod";
import type { PromptEntry } from "./types.js";

export const taskCompletenessPrompt: PromptEntry = {
  name: "task-completeness",
  description:
    "Fetch an Asana task, assess whether its description is fully actionable, ask targeted questions to fill gaps, then update the task description.",
  readOnly: true,
  argsSchema: {
    task_id: z.string().describe("The GID or URL of the task to analyze"),
  },
  handler: async (_client, args) => {
    const taskId = args?.task_id;
    if (!taskId) {
      throw new Error("Task ID or Task URL is required");
    }

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Fetch and analyze this Asana task, then help improve its description to be fully actionable.

Task: ${taskId}

## Process

1. **Fetch the task** using asana_get_task (extract the GID from the URL if a URL was provided). Also fetch its subtasks and comments for full context.

2. **Evaluate completeness** — check whether the task covers:
   • Clear, specific objective with defined scope
   • Deliverables with acceptance criteria
   • Technical requirements and specifications (if applicable)
   • Design/UX guidelines or references (if applicable)
   • Required resources, tools, and access
   • Dependencies on other tasks or team members (if applicable)
   • Timeline (deadlines, milestones, priority level)
   • Success criteria and validation methods
   • Stakeholder approval process (if applicable)

3. **Identify gaps** — what's missing that would prevent the assignee from:
   • Understanding exactly what needs to be done
   • Knowing how to approach it correctly
   • Knowing when the task is successfully complete
   • Accessing necessary resources
   • Coordinating with other team members

4. **Ask targeted questions** to fill the most critical gaps first. Be specific — vague questions waste time.

5. **Update the task** once you have the information:
   • Integrate new details seamlessly with existing content
   • Use clear section headings for readability
   • Highlight critical requirements or constraints
   • Add a subtask checklist if the work has distinct steps
   • Do not remove anything from the original description unless explicitly asked

The final description should be clear enough for anyone with the right skills to execute without needing to ask for clarification.
`,
          },
        },
      ],
    };
  },
};
