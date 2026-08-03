import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import type { AsanaClientWrapper } from "./asana-client-wrapper.js";
import { isReadOnlyMode } from "./config.js";
import {
  type CompletableResourceType,
  makeResourceCompleter,
} from "./lib/complete.js";
import { errorSummary, logError } from "./lib/logging.js";
import { analyzeTaskPrompt } from "./prompts/analyze-task.js";
import { asanaHelpPrompt } from "./prompts/asana-help.js";
import { capturePrompt } from "./prompts/capture.js";
import {
  estimateFromCodePrompt,
  impactAnalysisPrompt,
  linkTasksToCodePrompt,
  releaseNotesPrompt,
  roadmapGapAnalysisPrompt,
  techDebtRoadmapPrompt,
} from "./prompts/code-bridge.js";
import { contributionsPrompt } from "./prompts/contributions.js";
import { createTaskPrompt } from "./prompts/create-task.js";
import { estimatePrompt } from "./prompts/estimate.js";
import { flowReportPrompt } from "./prompts/flow-report.js";
import { goalProgressPrompt } from "./prompts/goal-progress.js";
import { logWorkPrompt } from "./prompts/log-work.js";
import { myTasksPrompt } from "./prompts/my-tasks.js";
import { overdueTriagePrompt } from "./prompts/overdue-triage.js";
import { portfolioHealthPrompt } from "./prompts/portfolio-health.js";
import { prioritizeBacklogPrompt } from "./prompts/prioritize-backlog.js";
import { projectOnboardingPrompt } from "./prompts/project-onboarding.js";
import { projectRisksPrompt } from "./prompts/project-risks.js";
import { projectSummaryPrompt } from "./prompts/project-summary.js";
import { sprintCapacityPrompt } from "./prompts/sprint-capacity.js";
import { sprintFromConfluencePrompt } from "./prompts/sprint-from-confluence.js";
import { sprintPlanningPrompt } from "./prompts/sprint-planning.js";
import { staleTasksPrompt } from "./prompts/stale-tasks.js";
import { standupPrompt } from "./prompts/standup.js";
import { statusUpdatePrompt } from "./prompts/status-update.js";
import { taskBreakdownPrompt } from "./prompts/task-breakdown.js";
import { taskCompletenessPrompt } from "./prompts/task-completeness.js";
import { taskHistoryPrompt } from "./prompts/task-history.js";
import { taskSummaryPrompt } from "./prompts/task-summary.js";
import { teamWorkloadPrompt } from "./prompts/team-workload.js";
import type { PromptEntry } from "./prompts/types.js";
import { unblockMePrompt } from "./prompts/unblock-me.js";
import { weeklyReviewPrompt } from "./prompts/weekly-review.js";

const allPromptEntries: PromptEntry[] = [
  // Discovery
  asanaHelpPrompt,
  // Task-level
  taskSummaryPrompt,
  taskHistoryPrompt,
  analyzeTaskPrompt,
  taskCompletenessPrompt,
  taskBreakdownPrompt,
  estimatePrompt,
  logWorkPrompt,
  // Project-level
  projectSummaryPrompt,
  statusUpdatePrompt,
  projectRisksPrompt,
  flowReportPrompt,
  projectOnboardingPrompt,
  overdueTriagePrompt,
  staleTasksPrompt,
  prioritizeBacklogPrompt,
  teamWorkloadPrompt,
  // Personal productivity
  myTasksPrompt,
  standupPrompt,
  weeklyReviewPrompt,
  unblockMePrompt,
  capturePrompt,
  // Cross-project
  contributionsPrompt,
  portfolioHealthPrompt,
  goalProgressPrompt,
  // Planning & creation
  sprintCapacityPrompt,
  sprintPlanningPrompt,
  sprintFromConfluencePrompt,
  createTaskPrompt,
  // Code bridge
  linkTasksToCodePrompt,
  techDebtRoadmapPrompt,
  estimateFromCodePrompt,
  releaseNotesPrompt,
  roadmapGapAnalysisPrompt,
  impactAnalysisPrompt,
];

/**
 * Which prompt arguments should offer live autocomplete, and against what.
 *
 * Without this, every command requires a raw numeric GID that the user has to
 * dig out of an Asana URL — the single biggest usability barrier. Matching is
 * by argument name because the naming is consistent across prompts.
 */
const ARG_COMPLETIONS: { pattern: RegExp; type: CompletableResourceType }[] = [
  { pattern: /^(task|task_id)$/, type: "task" },
  {
    pattern: /^(project|project_id|project_name|default_project)$/,
    type: "project",
  },
  { pattern: /^(user|assignee|owner)$/, type: "user" },
  { pattern: /^portfolio$/, type: "portfolio" },
  { pattern: /^(scope_id)$/, type: "project" },
];

function completionTypeFor(
  argName: string,
): CompletableResourceType | undefined {
  return ARG_COMPLETIONS.find((c) => c.pattern.test(argName))?.type;
}

/**
 * Wrap eligible string arguments in `completable` so MCP clients can offer a
 * dropdown of the user's real tasks/projects/people.
 */
function withCompleters(
  schema: ZodRawShape,
  client: AsanaClientWrapper,
): ZodRawShape {
  const out: Record<string, unknown> = {};
  for (const [key, zodType] of Object.entries(schema)) {
    const type = completionTypeFor(key);
    if (!type) {
      out[key] = zodType;
      continue;
    }
    try {
      out[key] = completable(
        zodType as any,
        makeResourceCompleter(client, type),
      );
    } catch {
      // A schema shape that cannot be wrapped must not break registration.
      out[key] = zodType;
    }
  }
  return out as ZodRawShape;
}

/** `task-history` -> "Task History". */
function defaultTitle(name: string): string {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function registerPrompts(
  server: McpServer,
  client: AsanaClientWrapper,
): void {
  for (const entry of allPromptEntries) {
    if (isReadOnlyMode && !entry.readOnly) continue;

    server.registerPrompt(
      entry.name,
      {
        title: entry.title ?? defaultTitle(entry.name),
        description: entry.description,
        argsSchema: withCompleters(entry.argsSchema, client) as any,
      },
      async (args: any) => {
        console.error("Received GetPromptRequest:", entry.name);
        try {
          return await entry.handler(
            client,
            args as Record<string, string | undefined>,
          );
        } catch (error) {
          // Raw errors carry the bearer token — always summarise.
          logError(`Error building prompt ${entry.name}`, error);
          const { message, hint } = errorSummary(error);
          // A thrown error surfaces as a protocol failure with no context, so
          // return an explanatory message the model can act on instead.
          return {
            messages: [
              {
                role: "user" as const,
                content: {
                  type: "text" as const,
                  text: `The \`/${entry.name}\` command could not gather its data.

**Error:** ${message}${hint ? `\n\n**Likely cause:** ${hint}` : ""}

Tell the user what went wrong and suggest a fix — commonly a missing or wrong identifier, or a workspace that needs to be specified. Do not retry automatically.`,
                },
              },
            ],
          };
        }
      },
    );
  }
}
