import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import type { PromptEntry } from "./types.js";

export const analyzeTaskPrompt: PromptEntry = {
  name: "analyze-task",
  description:
    "Score how well-defined and understandable an Asana task is. Pre-fetches the task, subtasks, and comments, then produces a clarity score with a per-dimension breakdown and specific improvement suggestions.",
  readOnly: true,
  argsSchema: {
    task_id: z.string().describe("The GID or URL of the task to analyze"),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const taskId = args?.task_id;
    if (!taskId) throw new Error("Task ID is required");

    const gid = taskId.includes("/")
      ? taskId.split("/").filter(Boolean).pop() ?? taskId
      : taskId;

    const [task, { data: subtasks }, { data: stories }] = await Promise.all([
      client.getTask(gid, {
        opt_fields:
          "name,notes,completed,assignee,assignee.name,due_on,projects,projects.name,tags,tags.name,num_subtasks,custom_fields,custom_fields.name,custom_fields.display_value",
      }),
      client.getSubtasksForTask(gid, {
        opt_fields: "name,completed,assignee,assignee.name",
      }),
      client.getStoriesForTask(gid, {
        opt_fields: "text,type,created_at,created_by,created_by.name",
      }),
    ]);

    const comments = stories.filter(
      (s: { type: string }) => s.type === "comment",
    );

    const notesLength = task.notes?.trim().length ?? 0;
    const notesPreview = task.notes
      ? task.notes.slice(0, 600) + (task.notes.length > 600 ? "\n[...truncated]" : "")
      : "No description";

    const subtaskSection =
      subtasks.length > 0
        ? subtasks
            .map(
              (s: { name: string; completed?: boolean; assignee?: { name?: string } | null }) =>
                `  - [${s.completed ? "x" : " "}] ${s.name}${s.assignee?.name ? ` (${s.assignee.name})` : ""}`,
            )
            .join("\n")
        : "  None";

    const commentSection =
      comments.length > 0
        ? comments
            .slice(0, 5)
            .map(
              (s: { created_by?: { name?: string } | null; created_at: string; text?: string }) =>
                `  [${new Date(s.created_at).toLocaleDateString()}] ${s.created_by?.name ?? "Unknown"}: ${(s.text ?? "").slice(0, 150)}${(s.text?.length ?? 0) > 150 ? "..." : ""}`,
            )
            .join("\n")
        : "  None";

    const customFieldSection =
      task.custom_fields
        ?.filter((f: { display_value?: string | null }) => f.display_value != null)
        .map((f: { name?: string; display_value?: string | null }) => `  ${f.name}: ${f.display_value}`)
        .join("\n") || "  None";

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Score how clear and actionable this Asana task is. All data is pre-fetched — do not call any additional tools.

## Task
- **Name:** ${task.name}
- **Assignee:** ${task.assignee?.name ?? "Unassigned"}
- **Due:** ${task.due_on ?? "No due date"}
- **Projects:** ${task.projects?.map((p: { name?: string }) => p.name ?? "").join(", ") || "None"}
- **Tags:** ${task.tags?.map((t: { name?: string }) => t.name ?? "").join(", ") || "None"}
- **Description length:** ${notesLength} characters

## Description
${notesPreview}

## Custom Fields
${customFieldSection}

## Subtasks (${subtasks.length})
${subtaskSection}

## Comments (${comments.length})
${commentSection}

---
Score this task on how well a new assignee could understand and execute it without asking questions.

## Scoring Rubric

Score each dimension 0–10, then compute a weighted overall score:

| Dimension | Weight | What to assess |
|---|---|---|
| **Objective clarity** | 25% | Is it clear *what* needs to be done and *why*? |
| **Scope definition** | 20% | Are the boundaries clear? What's in and out? |
| **Acceptance criteria** | 20% | How will the assignee know when it's done? |
| **Actionability** | 15% | Can someone start immediately, or do they need to ask for more info? |
| **Context & background** | 10% | Is enough context provided to make good decisions? |
| **Timeline** | 10% | Is there a due date? Is priority clear? |

## Output Format

Produce the analysis in this exact structure:

---
### Clarity Score: [X/100] — [Grade: A / B / C / D / F]

| Dimension | Score | Notes |
|---|---|---|
| Objective clarity | X/10 | [1-line assessment] |
| Scope definition | X/10 | [1-line assessment] |
| Acceptance criteria | X/10 | [1-line assessment] |
| Actionability | X/10 | [1-line assessment] |
| Context & background | X/10 | [1-line assessment] |
| Timeline | X/10 | [1-line assessment] |

### Top Issues
1. [Most impactful problem]
2. [Second most impactful problem]
3. [Third most impactful problem — omit if fewer than 3]

### Quick Wins
[2–3 specific, concrete additions that would most improve the score — be precise, not generic]

### Verdict
[1–2 sentence plain-language summary: would a skilled team member be able to execute this task today without asking for clarification?]
---`,
          },
        },
      ],
    };
  },
};
