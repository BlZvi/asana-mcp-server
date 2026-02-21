import { z } from "zod";
import { resolveWorkspace } from "../config.js";
import { jsonResponse } from "./helpers.js";
import type { ToolEntry } from "./types.js";

export const teamTools: ToolEntry[] = [
  {
    readOnly: true,
    name: "asana_get_team",
    description:
      "Get details for a team by GID. Returns gid, name, description, and organization. Use asana_get_teams_for_workspace to find team GIDs.",
    inputSchema: {
      team_gid: z
        .string()
        .describe(
          "The GID of the team (numeric string, e.g. `'1234567890123'`). Get team GIDs from asana_get_teams_for_workspace or from the `team.gid` field on a project.",
        ),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated extra fields to include. Useful values: `gid,name,description,organization.name,permalink_url,visibility`. Default fields: gid, resource_type, name.",
        ),
    },
    handler: async (client, { team_gid, ...opts }) =>
      jsonResponse(await client.getTeam(team_gid, opts)),
  },
  {
    readOnly: true,
    name: "asana_get_teams_for_workspace",
    description:
      "List all teams in a workspace. Returns gid and name for each team. Use this to find a team GID before calling asana_create_project — most organization workspaces require a team. Supports pagination.",
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
          "Comma-separated extra fields to include. Useful values: `gid,name,description,organization.name,visibility`. Default fields: gid, resource_type, name.",
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
        await client.getTeamsForWorkspace(resolveWorkspace(workspace), opts),
      ),
  },
];
