import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AsanaClientWrapper } from "./asana-client-wrapper.js";
import { isReadOnlyMode } from "./config.js";
import { attachmentTools } from "./tools/attachment-tools.js";
import { customFieldTools } from "./tools/custom-field-tools.js";
import { goalTools } from "./tools/goal-tools.js";
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
];

export function registerTools(
  server: McpServer,
  client: AsanaClientWrapper,
): void {
  for (const entry of allToolEntries) {
    if (isReadOnlyMode && !entry.readOnly) continue;
    server.tool(
      entry.name,
      entry.description,
      entry.inputSchema,
      async (args) => {
        console.error("Received CallToolRequest:", entry.name);
        try {
          return await entry.handler(client, args);
        } catch (error) {
          console.error("Error executing tool:", error);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: error instanceof Error ? error.message : String(error),
                }),
              },
            ],
          };
        }
      },
    );
  }
}
