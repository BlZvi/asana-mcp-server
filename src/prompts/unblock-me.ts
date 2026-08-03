import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import { asanaTimezone, resolveWorkspace } from "../config.js";
import { diffDays, todayISO } from "../lib/dates.js";
import type { PromptEntry } from "./types.js";

function userMessage(text: string): GetPromptResult {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

export const unblockMePrompt: PromptEntry = {
  name: "unblock-me",
  description:
    "Find what is blocking your work — tasks waiting on dependencies, on other people, or stuck in review — and draft the nudges needed to clear them. Turns 'I'm stuck' into specific, sendable follow-ups.",
  readOnly: true,
  argsSchema: {
    workspace_gid: z
      .string()
      .optional()
      .describe("Workspace GID. Defaults to ASANA_DEFAULT_WORKSPACE_GID."),
    include_blocking_others: z
      .string()
      .optional()
      .describe(
        "`true` (default) to also list your tasks that are blocking other people's work — often more urgent than your own blockers.",
      ),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const workspaceGid = resolveWorkspace(args?.workspace_gid);
    const today = todayISO(asanaTimezone);
    const includeBlocking =
      args?.include_blocking_others?.trim().toLowerCase() !== "false";

    const optFields =
      "name,permalink_url,due_on,modified_at,assignee.name,notes,projects.name,memberships.section.name,dependencies,num_subtasks";

    // Asana's search exposes is_blocked / is_blocking directly, which is far
    // cheaper than walking dependency edges per task.
    const [blockedRes, blockingRes] = await Promise.all([
      client
        .searchTasks(workspaceGid, {
          assignee_any: "me",
          completed: false,
          is_blocked: true,
          opt_fields: optFields,
        })
        .catch(() => ({ data: [] as any[] })),
      includeBlocking
        ? client
            .searchTasks(workspaceGid, {
              assignee_any: "me",
              completed: false,
              is_blocking: true,
              opt_fields: optFields,
            })
            .catch(() => ({ data: [] as any[] }))
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const blocked = blockedRes.data;
    const blocking = blockingRes.data;

    // Review-bound work is a blocker in practice even when Asana has no
    // formal dependency recorded.
    const inReview = await client
      .searchTasks(workspaceGid, {
        assignee_any: "me",
        completed: false,
        opt_fields: optFields,
      })
      .then(({ data }) =>
        data.filter((t: any) => {
          const section = (
            t.memberships?.[0]?.section?.name ?? ""
          ).toLowerCase();
          return /review|qa|verif|approv|waiting|blocked/.test(section);
        }),
      )
      .catch(() => [] as any[]);

    if (
      blocked.length === 0 &&
      blocking.length === 0 &&
      inReview.length === 0
    ) {
      return userMessage(
        `Nothing appears to be blocking you right now — no tasks assigned to you are marked blocked, blocking others, or sitting in a review/waiting section.

Tell the user their path is clear. If they still feel stuck, the blocker is probably not recorded in Asana; offer to help them identify and record it.`,
      );
    }

    const render = (tasks: any[]) =>
      tasks.length === 0
        ? "  None"
        : tasks
            .slice(0, 20)
            .map((t: any) => {
              const label = t.permalink_url
                ? `[${t.name}](${t.permalink_url})`
                : t.name;
              const idle = t.modified_at
                ? ` · idle ${diffDays(t.modified_at.slice(0, 10), today)}d`
                : "";
              const due = t.due_on
                ? ` · due ${t.due_on}${t.due_on < today ? " ⚠ OVERDUE" : ""}`
                : "";
              const project = t.projects?.[0]?.name
                ? ` · ${t.projects[0].name}`
                : "";
              const section = t.memberships?.[0]?.section?.name
                ? ` [${t.memberships[0].section.name}]`
                : "";
              return `  - ${label}${section}${project}${due}${idle} · gid \`${t.gid}\``;
            })
            .join("\n");

    return userMessage(
      `Help clear what is blocking my work. All data is pre-fetched — do not re-fetch it.

**As of ${today}**

## Blocked by a dependency (${blocked.length})
${render(blocked)}

## Sitting in review / waiting (${inReview.length})
${render(inReview)}

${includeBlocking ? `## My tasks that are blocking others (${blocking.length})\n${render(blocking)}` : ""}

---
Produce an unblocking plan:

1. **Act on these first** — Your tasks that are blocking *other people*. These cost the team more than your own blockers do. For each, say what you need to do to release the dependency.

2. **Chase these** — Work blocked on someone else. For each, identify who most likely owns the blocker and **draft a short, specific nudge message** that could be pasted straight into Asana or Slack. The nudge must reference what is needed and why it matters — not "any update on this?".

3. **Stale reviews** — Anything sitting in a review or waiting section for an unusually long time. Suggest whether to ping, escalate, or pull it back.

4. **Self-inflicted** — Anything "blocked" that you could actually unblock yourself with a decision. Be direct about these.

5. **Priority order** — Given due dates and how long each has been stuck, what should be tackled first?

Keep the drafted messages short and professional. A good nudge takes ten seconds to read and makes the specific ask obvious.`,
    );
  },
};
