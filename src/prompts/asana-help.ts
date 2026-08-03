import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import {
  asanaTimezone,
  cacheDisabled,
  defaultWorkspaceGid,
  isDryRunMode,
  isReadOnlyMode,
  sprintLengthDays,
} from "../config.js";
import type { PromptEntry } from "./types.js";

function userMessage(text: string): GetPromptResult {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

type Cmd = { name: string; what: string; example: string; write?: boolean };

const CATALOG: { group: string; blurb: string; cmds: Cmd[] }[] = [
  {
    group: "Daily work",
    blurb: "Start here — these answer 'what should I do now?'",
    cmds: [
      {
        name: "my-tasks",
        what: "Prioritized plan for today from your open tasks",
        example: "/my-tasks",
      },
      {
        name: "standup",
        what: "Done / doing / blockers summary",
        example: "/standup days_back=3",
      },
      {
        name: "unblock-me",
        what: "What is blocking you, plus drafted nudges to clear it",
        example: "/unblock-me",
      },
      {
        name: "weekly-review",
        what: "Weekly reflection and next-week plan",
        example: "/weekly-review",
      },
      {
        name: "capture",
        what: "Turn a braindump into real tasks",
        example: '/capture notes="..."',
        write: true,
      },
    ],
  },
  {
    group: "Understanding a task",
    blurb: "Dig into a single piece of work.",
    cmds: [
      {
        name: "task-summary",
        what: "Status summary with comments and context",
        example: "/task-summary task_id=<name|url|gid>",
      },
      {
        name: "task-history",
        what: "Full lifecycle: where it stalled, who touched it, why it slipped",
        example: '/task-history task="Fix login bug" focus=delays',
      },
      {
        name: "analyze-task",
        what: "Score how well-defined the task is (0–100)",
        example: "/analyze-task task_id=<...>",
      },
      {
        name: "task-completeness",
        what: "Find gaps, ask questions, improve the description",
        example: "/task-completeness task_id=<...>",
        write: true,
      },
      {
        name: "task-breakdown",
        what: "Split into well-scoped subtasks",
        example: "/task-breakdown task_id=<...>",
        write: true,
      },
      {
        name: "estimate",
        what: "Estimate by anchoring on similar completed work",
        example: '/estimate task="..." scale=fibonacci',
      },
    ],
  },
  {
    group: "Running a project",
    blurb: "Project-level health, risk, and planning.",
    cmds: [
      {
        name: "project-summary",
        what: "Full status report",
        example: "/project-summary project_id=<...>",
      },
      {
        name: "status-update",
        what: "Ready-to-send stakeholder update",
        example: "/status-update project_id=<...> audience=executive",
      },
      {
        name: "project-risks",
        what: "Risk register from real risk signals",
        example: "/project-risks project_id=<...>",
      },
      {
        name: "flow-report",
        what: "Cycle time, bottlenecks, throughput",
        example: '/flow-report project="Backend"',
      },
      {
        name: "overdue-triage",
        what: "Triage overdue work: do / reschedule / reassign / drop",
        example: "/overdue-triage project_id=<...>",
      },
      {
        name: "stale-tasks",
        what: "Find and clear forgotten work",
        example: '/stale-tasks project="Backend" stale_days=60',
      },
      {
        name: "prioritize-backlog",
        what: "Rank the backlog into P1–P4",
        example: "/prioritize-backlog project_id=<...>",
      },
      {
        name: "team-workload",
        what: "Who is overloaded, what is unassigned",
        example: "/team-workload project_id=<...>",
      },
      {
        name: "project-onboarding",
        what: "Getting-up-to-speed brief for someone new",
        example: "/project-onboarding project_id=<...>",
      },
    ],
  },
  {
    group: "Planning",
    blurb: "Deciding what to commit to.",
    cmds: [
      {
        name: "sprint-capacity",
        what: "How much to commit, from measured velocity",
        example: '/sprint-capacity scope_id="Backend"',
      },
      {
        name: "sprint-planning",
        what: "Build a sprint from the backlog",
        example: "/sprint-planning project_id=<...>",
      },
      {
        name: "sprint-from-confluence",
        what: "Create tasks from a Confluence page",
        example:
          "/sprint-from-confluence confluence_url=<...> project_name=<...>",
        write: true,
      },
      {
        name: "create-task",
        what: "Guided task creation",
        example: "/create-task project_name=<...> title=<...>",
        write: true,
      },
      {
        name: "log-work",
        what: "Retro-log work done outside Asana",
        example: "/log-work project_name=<...> description=<...>",
        write: true,
      },
    ],
  },
  {
    group: "People and portfolio",
    blurb: "Cross-project and cross-person views.",
    cmds: [
      {
        name: "contributions",
        what: "What someone worked on over a period",
        example: "/contributions user=me period=3m",
      },
      {
        name: "portfolio-health",
        what: "Roll-up across every project in a portfolio",
        example: '/portfolio-health portfolio="Q1"',
      },
      {
        name: "goal-progress",
        what: "Tracking against goals, with pace analysis",
        example: "/goal-progress",
      },
    ],
  },
  {
    group: "Code ↔ Asana",
    blurb:
      "These need your client to have git/filesystem tools. They degrade gracefully if not.",
    cmds: [
      {
        name: "link-tasks-to-code",
        what: "Which tasks have code, which commits have no task",
        example: '/link-tasks-to-code project="Backend"',
      },
      {
        name: "tech-debt-roadmap",
        what: "TODOs and churn hotspots into a reviewed backlog",
        example: '/tech-debt-roadmap project="Backend"',
        write: true,
      },
      {
        name: "estimate-from-code",
        what: "Estimate grounded in the actual change surface",
        example: '/estimate-from-code task="..."',
      },
      {
        name: "release-notes",
        what: "Changelog from completed tasks plus commits",
        example: '/release-notes project="Backend" audience=users',
      },
      {
        name: "roadmap-gap-analysis",
        what: "Does the code back up what the roadmap claims?",
        example: '/roadmap-gap-analysis project="Roadmap"',
      },
      {
        name: "impact-analysis",
        what: "Blast radius and the right owner for a change",
        example: '/impact-analysis description="..."',
      },
    ],
  },
];

export const asanaHelpPrompt: PromptEntry = {
  name: "asana-help",
  description:
    "List everything this Asana server can do, grouped by what you are trying to accomplish, with copy-pasteable examples. Start here if you are not sure which command to use.",
  readOnly: true,
  argsSchema: {
    topic: z
      .string()
      .optional()
      .describe(
        "Optional filter — a keyword like 'sprint', 'code', 'estimate', or a group name. Omit to see everything.",
      ),
  },
  handler: async (_client: AsanaClientWrapper, args) => {
    const topic = args?.topic?.trim().toLowerCase();

    const groups = topic
      ? CATALOG.map((g) => ({
          ...g,
          cmds: g.cmds.filter(
            (c) =>
              c.name.includes(topic) ||
              c.what.toLowerCase().includes(topic) ||
              g.group.toLowerCase().includes(topic),
          ),
        })).filter((g) => g.cmds.length > 0)
      : CATALOG;

    if (groups.length === 0) {
      return userMessage(
        `No Asana commands match "${topic}". Suggest the user re-run \`/asana-help\` with no topic to see the full list.`,
      );
    }

    const visible = (c: Cmd) => !(isReadOnlyMode && c.write);

    const body = groups
      .map((g) => {
        const rows = g.cmds
          .filter(visible)
          .map(
            (c) =>
              `| \`/${c.name}\`${c.write ? " ✎" : ""} | ${c.what} | \`${c.example}\` |`,
          )
          .join("\n");
        if (rows === "") return "";
        return `### ${g.group}\n${g.blurb}\n\n| Command | What it does | Example |\n|---|---|---|\n${rows}`;
      })
      .filter(Boolean)
      .join("\n\n");

    const modeNotes: string[] = [];
    if (isReadOnlyMode)
      modeNotes.push(
        "**Read-only mode is ON** — commands that write to Asana are hidden and all write tools are disabled.",
      );
    if (isDryRunMode)
      modeNotes.push(
        "**Dry-run mode is ON** — write tools report what they would do without changing anything.",
      );
    if (!defaultWorkspaceGid)
      modeNotes.push(
        "**No default workspace is set.** Set `ASANA_DEFAULT_WORKSPACE_GID` to avoid passing a workspace to every command.",
      );
    if (cacheDisabled) modeNotes.push("Response caching is disabled.");

    return userMessage(
      `Present this Asana capability guide to the user. Reformat for readability if helpful, but keep every command and example intact.

# What this Asana server can do

${body}

${isReadOnlyMode ? "" : "✎ = creates or modifies data in Asana (always previews before writing)\n"}
## Tips
- **Names work everywhere.** Most commands accept a task/project *name* or an Asana *URL* — you rarely need a raw GID.
- **Ambiguous names are safe.** If a name matches several things, you get a disambiguation list rather than a wrong guess.
- **Analytics report their own coverage.** Anything that samples data tells you how much it actually looked at, so partial results are never mistaken for complete ones.
- There are also ~85 lower-level tools (\`asana_*\`) for direct API access when a command does not fit.

## Current configuration
- Timezone: \`${asanaTimezone}\`
- Default sprint length: ${sprintLengthDays} days
${modeNotes.length > 0 ? modeNotes.map((n) => `- ${n}`).join("\n") : "- Read/write enabled, default workspace configured."}

After showing this, ask what the user is trying to accomplish and recommend the single best command for it.`,
    );
  },
};
