import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import { asanaTimezone, isDryRunMode, resolveWorkspace } from "../config.js";
import { todayISO } from "../lib/dates.js";
import type { PromptEntry } from "./types.js";

function userMessage(text: string): GetPromptResult {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

export const capturePrompt: PromptEntry = {
  name: "capture",
  description:
    "Turn a freeform braindump — meeting notes, a list of thoughts, pasted text — into well-formed Asana tasks in the right projects. Previews everything before creating. The fastest path from 'things in my head' to tracked work.",
  readOnly: false,
  argsSchema: {
    notes: z
      .string()
      .describe(
        "The raw text to turn into tasks. Meeting notes, a bullet list, a paragraph of thoughts — structure is not required.",
      ),
    default_project: z
      .string()
      .optional()
      .describe(
        "Project to use for items with no obvious home (name or GID). If omitted, you will be asked where ambiguous items should go.",
      ),
    assign_to_me: z
      .string()
      .optional()
      .describe(
        "`true` to assign every created task to the current user, `false` (default) to leave assignment to be decided per item.",
      ),
    workspace_gid: z
      .string()
      .optional()
      .describe("Workspace GID. Defaults to ASANA_DEFAULT_WORKSPACE_GID."),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const workspaceGid = resolveWorkspace(args?.workspace_gid);
    const notes = args?.notes;
    if (!notes || notes.trim() === "") {
      throw new Error("Some notes or text to capture are required");
    }

    const today = todayISO(asanaTimezone);
    const assignToMe = args?.assign_to_me?.trim().toLowerCase() === "true";

    // A project shortlist lets the model route items without a round-trip.
    let projectList = "";
    try {
      const projects = await client.searchProjects(workspaceGid, ".*", false, {
        opt_fields: "name,gid",
      });
      projectList = projects
        .slice(0, 40)
        .map((p: any) => `  - ${p.name} (\`${p.gid}\`)`)
        .join("\n");
    } catch {
      projectList = "";
    }

    const dryRunNote = isDryRunMode
      ? `\n\n> **DRY RUN MODE IS ACTIVE.** Write tools will report what they would do without changing anything in Asana. Say so when you present the results.`
      : "";

    return userMessage(
      `Turn these notes into well-formed Asana tasks.

## Raw notes
\`\`\`
${notes}
\`\`\`

**Today:** ${today}${args?.default_project ? `\n**Default project:** ${args.default_project}` : ""}${assignToMe ? `\n**Assignment:** assign everything to the current user (\`me\`)` : ""}

## Available projects
${projectList || "  (Could not list projects — use `asana_search_projects` to find the right one.)"}
${dryRunNote}

---
## Process

**Step 1 — Extract.** Pull out every distinct piece of work implied by the notes. Include explicit todos, decisions that require follow-up, questions needing an answer, and commitments made to other people. Ignore pure information with no action attached.

**Step 2 — Shape each item.** For every extracted task:
- Write an action-oriented title starting with a verb ("Draft the migration plan", not "Migration plan")
- Add a description carrying the context from the notes, so it still makes sense in a month
- Infer a due date if the notes imply timing ("by Friday", "before the launch") — resolve relative dates against ${today}
- Infer an assignee if a person is named
- Choose the target project from the list above; use the default for anything ambiguous

**Step 3 — Preview and confirm.** Present the complete list as a table (title | project | assignee | due date) and ask:
- Anything to drop, merge, or split?
- Are the project assignments right?
- Any missing dates or owners?

**Do not create anything until the user confirms.**

**Step 4 — Create.** After confirmation, use \`asana_create_task\` for each item. Create them one at a time and report progress as you go.

**Step 5 — Report.** List every created task with its name, GID, and permalink so the user has a record.

If an item is too vague to become a good task, say so and ask for the missing detail rather than creating something unactionable.`,
    );
  },
};
