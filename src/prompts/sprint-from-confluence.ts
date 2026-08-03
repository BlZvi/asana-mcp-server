import { z } from "zod";
import type { PromptEntry } from "./types.js";

export const sprintFromConfluencePrompt: PromptEntry = {
  name: "sprint-from-confluence",
  description:
    "Fetch a Confluence page, extract work items or requirements, and create corresponding Asana tasks in a project. Bridges research/planning docs directly into actionable work.",
  readOnly: false,
  argsSchema: {
    confluence_url: z
      .string()
      .describe(
        "URL of the Confluence page containing the work items or requirements",
      ),
    project_name: z
      .string()
      .describe("Name of the Asana project to create tasks in"),
    sprint_section: z
      .string()
      .optional()
      .describe(
        "Name of the section within the project to place new tasks in (e.g. 'Sprint 5', 'Backlog'). If not provided, tasks are added without a specific section.",
      ),
    workspace_gid: z
      .string()
      .optional()
      .describe("Workspace GID (defaults to ASANA_DEFAULT_WORKSPACE_GID)"),
    task_type: z
      .string()
      .optional()
      .describe(
        "What to extract: 'action-items' (explicit tasks/todos), 'requirements' (features/specs to implement), or 'all' (everything that implies work). Default: 'all'",
      ),
  },
  handler: async (_client, args) => {
    const confluenceUrl = args?.confluence_url;
    const projectName = args?.project_name;

    if (!confluenceUrl) throw new Error("Confluence URL is required");
    if (!projectName) throw new Error("Project name is required");

    const sprintSection = args?.sprint_section;
    const taskType = args?.task_type ?? "all";

    const extractionGuide: Record<string, string> = {
      "action-items":
        "Extract only explicit action items, todos, or decisions that require follow-up work. Look for checkboxes, bullet points under 'Action Items' or 'Next Steps' headers, and any text that assigns work to someone.",
      requirements:
        "Extract features, requirements, and specifications that need to be implemented. Each requirement should become a task. Look for 'must', 'should', 'will', functional specs, and user stories.",
      all: "Extract everything that implies work: action items, requirements, features to build, bugs to fix, research to do, decisions to implement, and follow-ups. Cast a wide net.",
    };

    const guide = extractionGuide[taskType] ?? extractionGuide.all;

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Fetch a Confluence page and create Asana tasks from its content.

## Input
- **Confluence URL:** ${confluenceUrl}
- **Target project:** ${projectName}${
              sprintSection
                ? `
- **Target section:** ${sprintSection}`
                : ""
            }
- **Extraction type:** ${taskType}

## Step 1: Fetch the Confluence page
Use available Confluence tools to fetch the content of: ${confluenceUrl}

If no Confluence tool is available, ask the user to paste the page content directly.

## Step 2: Extract work items
${guide}

For each extracted item, note:
- The task title (concise, action-oriented verb phrase)
- Any description, context, or acceptance criteria from the page
- Assignee if mentioned in the Confluence page
- Due date or deadline if specified
- Dependencies on other items (if apparent)

Present the extracted list to the user and confirm before creating anything. Ask:
- Are there items to remove or combine?
- Are there items missing that should be added?
- Any assignee or due date adjustments?

## Step 3: Find the project
Use asana_search_projects to find the project named "${projectName}" and get its GID.${
              sprintSection
                ? `
Then use asana_get_project_sections to find the section named "${sprintSection}" and get its GID.`
                : ""
            }

## Step 4: Create the tasks
For each confirmed work item, use asana_create_task with:
- Task name: clear, action-oriented title
- Notes: description from the Confluence page, plus source reference ("From Confluence: ${confluenceUrl}")
- Project: the project GID${
              sprintSection
                ? `
- Memberships: place in the "${sprintSection}" section`
                : ""
            }
- Assignee and due date if determined in Step 2

Create tasks one at a time and report progress.

## Step 5: Confirm
List all created tasks with their Asana GIDs so the user has a complete record.`,
          },
        },
      ],
    };
  },
};
