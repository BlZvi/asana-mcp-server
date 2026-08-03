import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AsanaClientWrapper } from "./asana-client-wrapper.js";
import { isDryRunMode, isReadOnlyMode } from "./config.js";
import { errorSummary, logError } from "./lib/logging.js";
import { activityTools } from "./tools/activity-tools.js";
import { attachmentTools } from "./tools/attachment-tools.js";
import { codeTools } from "./tools/code-tools.js";
import { customFieldTools } from "./tools/custom-field-tools.js";
import { estimationTools } from "./tools/estimation-tools.js";
import { goalTools } from "./tools/goal-tools.js";
import { historyTools } from "./tools/history-tools.js";
import { portfolioTools } from "./tools/portfolio-tools.js";
import { projectStatusTools } from "./tools/project-status-tools.js";
import { projectTools } from "./tools/project-tools.js";
import { sectionTools } from "./tools/section-tools.js";
import { storyTools } from "./tools/story-tools.js";
import { tagTools } from "./tools/tag-tools.js";
import { taskRelationshipTools } from "./tools/task-relationship-tools.js";
import { taskTools } from "./tools/task-tools.js";
import { teamTools } from "./tools/team-tools.js";
import { timeTools } from "./tools/time-tools.js";
import { typeaheadTools } from "./tools/typeahead-tools.js";
import type { ToolEntry } from "./tools/types.js";
import { userTools } from "./tools/user-tools.js";
import { workspaceTools } from "./tools/workspace-tools.js";

const allToolEntries: ToolEntry[] = [
  ...workspaceTools,
  ...userTools,
  ...teamTools,
  ...typeaheadTools,
  ...projectTools,
  ...projectStatusTools,
  ...taskTools,
  ...taskRelationshipTools,
  ...storyTools,
  ...tagTools,
  ...sectionTools,
  ...portfolioTools,
  ...goalTools,
  ...timeTools,
  ...attachmentTools,
  ...customFieldTools,
  // Analytics and cross-system tools
  ...historyTools,
  ...activityTools,
  ...estimationTools,
  ...codeTools,
];

/** `asana_get_task_history` -> "Get Task History". */
function defaultTitle(name: string): string {
  return name
    .replace(/^asana_/, "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Tools whose effects cannot be undone.
 *
 * Marked separately from "not read-only" so clients can require confirmation
 * for genuine data loss without nagging on every ordinary update.
 */
function isDestructive(entry: ToolEntry): boolean {
  if (entry.destructive !== undefined) return entry.destructive;
  return /^asana_(delete|remove)_/.test(entry.name);
}

function isIdempotent(entry: ToolEntry): boolean {
  if (entry.idempotent !== undefined) return entry.idempotent;
  if (entry.readOnly) return true;
  return /^asana_(update|set|add|remove|delete)_/.test(entry.name);
}

export function registerTools(
  server: McpServer,
  client: AsanaClientWrapper,
): void {
  for (const entry of allToolEntries) {
    if (isReadOnlyMode && !entry.readOnly) continue;

    server.registerTool(
      entry.name,
      {
        title: entry.title ?? defaultTitle(entry.name),
        description: entry.description,
        inputSchema: entry.inputSchema,
        annotations: {
          readOnlyHint: entry.readOnly,
          destructiveHint: isDestructive(entry),
          idempotentHint: isIdempotent(entry),
          openWorldHint: true,
        },
      },
      async (args: any) => {
        console.error("Received CallToolRequest:", entry.name);

        // Dry run keeps write tools visible (so the model can plan a full
        // sequence) while guaranteeing nothing reaches Asana.
        if (isDryRunMode && !entry.readOnly) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  dry_run: true,
                  would_call: entry.name,
                  with_arguments: args,
                  message: `DRY RUN — no change was made in Asana. \`${entry.name}\` would have been called with the arguments above. Unset ASANA_DRY_RUN to execute for real.`,
                }),
              },
            ],
          };
        }

        try {
          return await entry.handler(client, args);
        } catch (error) {
          // Never log the raw error: the Asana SDK embeds the bearer token in
          // every failure it throws.
          logError(`Error executing tool ${entry.name}`, error);
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  ...errorSummary(error),
                  tool: entry.name,
                }),
              },
            ],
          };
        }
      },
    );
  }
}
