import { z } from "zod";
import { resolveWorkspace } from "../config.js";
import { jsonResponse } from "./helpers.js";
import type { ToolEntry } from "./types.js";

export const userTools: ToolEntry[] = [
  {
    readOnly: true,
    name: "asana_get_user",
    description:
      "Get details for an Asana user by GID, email address, or `'me'` (current user). Returns gid, name, and email by default. Use `'me'` to identify the current token's user. Use asana_get_users_for_workspace to find GIDs by name or email.",
    inputSchema: {
      user_gid: z
        .string()
        .describe(
          "The user identifier: a GID (numeric string), an email address, or `'me'` for the current user.",
        ),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated extra fields to include. Useful values: `gid,name,email,photo,workspaces.name`. Default fields: gid, resource_type, name.",
        ),
    },
    handler: async (client, { user_gid, ...opts }) =>
      jsonResponse(await client.getUser(user_gid, opts)),
  },
  {
    readOnly: true,
    name: "asana_get_users_for_workspace",
    description:
      "List all users in a workspace. Returns gid, name, and email for each user. Use this to find a user's GID before assigning tasks or filtering by assignee. Supports pagination for large workspaces.",
    inputSchema: {
      workspace: z
        .string()
        .optional()
        .describe(
          "The GID of the workspace (numeric string, e.g. `'1234567890123'`). Get it from asana_list_workspaces. Can be omitted if ASANA_DEFAULT_WORKSPACE_GID is set.",
        ),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated extra fields to include. Useful values: `gid,name,email,photo`. Default fields: gid, resource_type, name.",
        ),
      limit: z.number().int().optional().describe("Results per page (1-100)."),
      offset: z
        .string()
        .optional()
        .describe(
          "Pagination offset token from a previous response's next_page.offset.",
        ),
    },
    handler: async (client, { workspace, ...opts }) =>
      jsonResponse(
        await client.getUsersForWorkspace(resolveWorkspace(workspace), opts),
      ),
  },
];
