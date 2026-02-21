import { z } from "zod";
import { jsonResponse } from "./helpers.js";
import type { ToolEntry } from "./types.js";

export const workspaceTools: ToolEntry[] = [
  {
    name: "asana_list_workspaces",
    description:
      "List all Asana workspaces accessible to the current token. Call this first to get the workspace GID required by most other tools. Most accounts have exactly one workspace. Returns an array with gid, resource_type, and name by default.",
    readOnly: true,
    inputSchema: {
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated extra fields to include. Useful values: `is_organization,email_domains`. Default fields: gid, name, resource_type.",
        ),
    },
    handler: async (client, args) =>
      jsonResponse(await client.listWorkspaces(args)),
  },
];
