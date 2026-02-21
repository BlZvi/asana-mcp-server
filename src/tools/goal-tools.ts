import { z } from "zod";
import { resolveWorkspace } from "../config.js";
import { jsonResponse, successResponse } from "./helpers.js";
import type { ToolEntry } from "./types.js";

export const goalTools: ToolEntry[] = [
  {
    readOnly: true,
    name: "asana_get_goal",
    description:
      "Get full details for a goal by GID. Returns name, status, notes, owner, team, time_period, followers, and workspace. Use asana_get_goals to list goals and find GIDs.",
    inputSchema: {
      goal_gid: z
        .string()
        .describe(
          "The GID of the goal (numeric string, e.g. `'1234567890123'`). Get goal GIDs from asana_get_goals.",
        ),
      opt_fields: z
        .string()
        .describe(
          "Comma-separated extra fields to include. Useful values: `gid,name,status,notes,due_on,start_on,owner.name,team.name,time_period.display_name,followers.name,workspace.name,is_workspace_level,metric`. Default fields: gid, resource_type, and several others.",
        )
        .optional(),
    },
    handler: async (client, { goal_gid, ...opts }) =>
      jsonResponse(await client.getGoal(goal_gid, opts)),
  },
  {
    readOnly: true,
    name: "asana_get_goals",
    description:
      "List goals in a workspace. Returns an array of goal objects with gid, name, status, owner, and team. Filter by team or time period using optional params. Supports pagination.",
    inputSchema: {
      workspace: z
        .string()
        .optional()
        .describe(
          "The GID of the workspace (numeric string, e.g. `'1234567890123'`). Get it from asana_list_workspaces. Can be omitted if ASANA_DEFAULT_WORKSPACE_GID is set.",
        ),
      team: z
        .string()
        .describe(
          "Filter to goals belonging to a specific team GID. Omit to get goals across all teams.",
        )
        .optional(),
      is_workspace_level: z
        .boolean()
        .describe(
          "Set to true to only return workspace-level goals (not team-specific goals).",
        )
        .optional(),
      time_periods: z
        .string()
        .describe(
          "Comma-separated list of time period GIDs to filter by. Get time period GIDs from asana_get_time_periods.",
        )
        .optional(),
      limit: z.number().describe("Results per page (1-100).").optional(),
      offset: z
        .string()
        .describe(
          "Pagination offset token from a previous response's next_page.offset.",
        )
        .optional(),
      opt_fields: z
        .string()
        .describe(
          "Comma-separated extra fields to include. Useful values: `gid,name,status,due_on,owner.name,team.name,time_period.display_name`. Default fields: gid, resource_type.",
        )
        .optional(),
    },
    handler: async (client, { workspace, ...opts }) =>
      jsonResponse(await client.getGoals(resolveWorkspace(workspace), opts)),
  },
  {
    readOnly: false,
    name: "asana_create_goal",
    description:
      "Create a new goal in a workspace. IMPORTANT: `time_period` is required by the Asana API — get valid GIDs from asana_get_time_periods. Returns the created goal object. Note: `status` can only be set after a goal metric is configured.",
    inputSchema: {
      workspace: z
        .string()
        .optional()
        .describe(
          "The GID of the workspace (numeric string, e.g. `'1234567890123'`). Get it from asana_list_workspaces. Can be omitted if ASANA_DEFAULT_WORKSPACE_GID is set.",
        ),
      name: z.string().describe("Name of the goal."),
      time_period: z
        .string()
        .describe(
          "Required. GID of the time period this goal belongs to. Get valid GIDs from asana_get_time_periods.",
        )
        .optional(),
      notes: z
        .string()
        .describe("Plain-text description of the goal.")
        .optional(),
      html_notes: z
        .string()
        .describe("HTML-formatted description. Root element must be `<body>`.")
        .optional(),
      due_on: z.string().describe("Due date in YYYY-MM-DD format.").optional(),
      start_on: z
        .string()
        .describe("Start date in YYYY-MM-DD format.")
        .optional(),
      status: z
        .enum([
          "green",
          "yellow",
          "red",
          "achieved",
          "partial",
          "missed",
          "dropped",
        ])
        .describe(
          "Goal status. Valid values: `green`, `yellow`, `red`, `achieved`, `partial`, `missed`, `dropped`. Can only be set after a goal metric is configured.",
        )
        .optional(),
      team: z
        .string()
        .describe(
          "GID of the team this goal belongs to. Omit for workspace-level goals.",
        )
        .optional(),
      owner: z
        .string()
        .describe("GID of the user who owns this goal.")
        .optional(),
      opt_fields: z
        .string()
        .describe(
          "Comma-separated fields to include in the response. Useful values: `gid,name,status,due_on,time_period.display_name,owner.name`.",
        )
        .optional(),
    },
    handler: async (client, { workspace, opt_fields, ...data }) =>
      jsonResponse(
        await client.createGoal(
          { ...data, workspace: resolveWorkspace(workspace) },
          { opt_fields },
        ),
      ),
  },
  {
    readOnly: false,
    name: "asana_update_goal",
    description:
      "Update fields on an existing goal. Only supply the fields to change. Returns the updated goal object. Note: setting `status` requires the goal to have a metric configured first — otherwise the API returns an error.",
    inputSchema: {
      goal_gid: z
        .string()
        .describe(
          "The GID of the goal to update (numeric string, e.g. `'1234567890123'`).",
        ),
      name: z.string().describe("New name for the goal.").optional(),
      notes: z.string().describe("New plain-text description.").optional(),
      html_notes: z
        .string()
        .describe(
          "New HTML-formatted description. Root element must be `<body>`.",
        )
        .optional(),
      due_on: z
        .string()
        .describe("New due date in YYYY-MM-DD format.")
        .optional(),
      start_on: z
        .string()
        .describe("New start date in YYYY-MM-DD format.")
        .optional(),
      status: z
        .enum([
          "green",
          "yellow",
          "red",
          "achieved",
          "partial",
          "missed",
          "dropped",
        ])
        .describe(
          "New goal status. Valid values: `green`, `yellow`, `red`, `achieved`, `partial`, `missed`, `dropped`. IMPORTANT: requires the goal to have a metric configured — the API returns an error if no metric is set.",
        )
        .optional(),
      owner: z.string().describe("New owner user GID.").optional(),
      opt_fields: z
        .string()
        .describe(
          "Comma-separated fields to include in the response. Useful values: `gid,name,status,due_on,owner.name`.",
        )
        .optional(),
    },
    handler: async (client, { goal_gid, opt_fields, ...data }) =>
      jsonResponse(await client.updateGoal(goal_gid, data, { opt_fields })),
  },
  {
    readOnly: false,
    name: "asana_delete_goal",
    description:
      "Permanently delete a goal. This cannot be undone. Returns a success message.",
    inputSchema: {
      goal_gid: z
        .string()
        .describe(
          "The GID of the goal to delete (numeric string, e.g. `'1234567890123'`).",
        ),
    },
    handler: async (client, { goal_gid }) => {
      await client.deleteGoal(goal_gid);
      return successResponse(`Successfully deleted goal ${goal_gid}`);
    },
  },
];
