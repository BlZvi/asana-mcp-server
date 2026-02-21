import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AsanaClientWrapper } from "./asana-client-wrapper.js";
import { isReadOnlyMode } from "./config.js";
import { analyzeTaskPrompt } from "./prompts/analyze-task.js";
import { createTaskPrompt } from "./prompts/create-task.js";
import { logWorkPrompt } from "./prompts/log-work.js";
import { myTasksPrompt } from "./prompts/my-tasks.js";
import { overdueTriagePrompt } from "./prompts/overdue-triage.js";
import { prioritizeBacklogPrompt } from "./prompts/prioritize-backlog.js";
import { projectOnboardingPrompt } from "./prompts/project-onboarding.js";
import { projectRisksPrompt } from "./prompts/project-risks.js";
import { projectSummaryPrompt } from "./prompts/project-summary.js";
import { sprintFromConfluencePrompt } from "./prompts/sprint-from-confluence.js";
import { sprintPlanningPrompt } from "./prompts/sprint-planning.js";
import { standupPrompt } from "./prompts/standup.js";
import { statusUpdatePrompt } from "./prompts/status-update.js";
import { taskBreakdownPrompt } from "./prompts/task-breakdown.js";
import { taskCompletenessPrompt } from "./prompts/task-completeness.js";
import { taskSummaryPrompt } from "./prompts/task-summary.js";
import { teamWorkloadPrompt } from "./prompts/team-workload.js";
import { weeklyReviewPrompt } from "./prompts/weekly-review.js";
import type { PromptEntry } from "./prompts/types.js";

const allPromptEntries: PromptEntry[] = [
  // Task-level
  taskSummaryPrompt,
  analyzeTaskPrompt,
  taskCompletenessPrompt,
  taskBreakdownPrompt,
  logWorkPrompt,
  // Project-level read
  projectSummaryPrompt,
  statusUpdatePrompt,
  projectRisksPrompt,
  projectOnboardingPrompt,
  overdueTriagePrompt,
  prioritizeBacklogPrompt,
  teamWorkloadPrompt,
  // Personal productivity
  myTasksPrompt,
  standupPrompt,
  weeklyReviewPrompt,
  // Planning & creation
  sprintPlanningPrompt,
  sprintFromConfluencePrompt,
  createTaskPrompt,
];

export function registerPrompts(
  server: McpServer,
  client: AsanaClientWrapper,
): void {
  for (const entry of allPromptEntries) {
    if (isReadOnlyMode && !entry.readOnly) continue;
    server.prompt(
      entry.name,
      entry.description,
      entry.argsSchema,
      async (args) => {
        console.error("Received GetPromptRequest:", entry.name);
        return entry.handler(
          client,
          args as Record<string, string | undefined>,
        );
      },
    );
  }
}
