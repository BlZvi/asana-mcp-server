import { z } from "zod";
import { resolveWorkspace } from "../config.js";
import { jsonResponse, successResponse } from "./helpers.js";
import type { ToolEntry } from "./types.js";

export const timeTools: ToolEntry[] = [
  {
    readOnly: true,
    name: "asana_get_time_periods",
    description:
      "List all time periods in a workspace (fiscal years, halves, and quarters). Time periods are used to scope goals. Returns a hierarchical array: FY (fiscal year) → H (half-year) → Q (quarter), each with gid, display_name, start_on, end_on, and parent. Use the GIDs with asana_create_goal or asana_get_goals.",
    inputSchema: {
      workspace: z
        .string()
        .optional()
        .describe(
          "The GID of the workspace (numeric string, e.g. `'1234567890123'`). Get it from asana_list_workspaces. Can be omitted if ASANA_DEFAULT_WORKSPACE_GID is set.",
        ),
      start_on: z
        .string()
        .describe(
          "Filter to time periods starting on or after this date (YYYY-MM-DD format).",
        )
        .optional(),
      end_on: z
        .string()
        .describe(
          "Filter to time periods ending on or before this date (YYYY-MM-DD format).",
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
          "Comma-separated extra fields to include. Useful values: `gid,display_name,start_on,end_on,parent.display_name,parent.gid`. Default fields: gid, resource_type.",
        )
        .optional(),
    },
    handler: async (client, { workspace, ...opts }) =>
      jsonResponse(
        await client.getTimePeriods(resolveWorkspace(workspace), opts),
      ),
  },
  {
    readOnly: true,
    name: "asana_get_time_period",
    description:
      "Get full details for a single time period by GID. Returns display_name, start_on, end_on, and parent time period. Use asana_get_time_periods to find GIDs.",
    inputSchema: {
      time_period_gid: z
        .string()
        .describe(
          "The GID of the time period (numeric string, e.g. `'1234567890123'`). Get GIDs from asana_get_time_periods.",
        ),
      opt_fields: z
        .string()
        .describe(
          "Comma-separated extra fields to include. Useful values: `gid,display_name,start_on,end_on,parent.display_name,parent.gid`. Default fields: gid, resource_type.",
        )
        .optional(),
    },
    handler: async (client, { time_period_gid, ...opts }) =>
      jsonResponse(await client.getTimePeriod(time_period_gid, opts)),
  },
  {
    readOnly: true,
    name: "asana_get_time_tracking_entries",
    description:
      "List all time tracking entries logged for a task. Returns an array of entry objects with gid, duration_minutes, entered_on, and created_by. Note: time tracking must be enabled in the workspace.",
    inputSchema: {
      task_gid: z
        .string()
        .describe(
          "The GID of the task (numeric string, e.g. `'1234567890123'`).",
        ),
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
          "Comma-separated extra fields to include. Useful values: `gid,duration_minutes,entered_on,created_by.name,task.name`. Default fields: gid, resource_type.",
        )
        .optional(),
    },
    handler: async (client, { task_gid, ...opts }) =>
      jsonResponse(await client.getTimeTrackingEntriesForTask(task_gid, opts)),
  },
  {
    readOnly: false,
    name: "asana_create_time_tracking_entry",
    description:
      "Log time spent on a task. Returns the created entry with gid, duration_minutes, entered_on, and created_by. Note: time tracking must be enabled in the workspace.",
    inputSchema: {
      task_gid: z
        .string()
        .describe(
          "The GID of the task to log time on (numeric string, e.g. `'1234567890123'`).",
        ),
      duration_minutes: z
        .number()
        .describe("Number of minutes to log. Must be a positive integer."),
      entered_on: z
        .string()
        .describe(
          "The date the time was worked, in YYYY-MM-DD format. Defaults to today if omitted.",
        )
        .optional(),
      opt_fields: z
        .string()
        .describe(
          "Comma-separated fields to include in the response. Useful values: `gid,duration_minutes,entered_on,created_by.name,task.name`.",
        )
        .optional(),
    },
    handler: async (client, { task_gid, opt_fields, ...data }) =>
      jsonResponse(
        await client.createTimeTrackingEntry(task_gid, data, { opt_fields }),
      ),
  },
  {
    readOnly: true,
    name: "asana_get_time_tracking_entry",
    description:
      "Get a single time tracking entry by GID. Returns gid, duration_minutes, entered_on, created_by, and task. Use asana_get_time_tracking_entries to find entry GIDs.",
    inputSchema: {
      time_tracking_entry_gid: z
        .string()
        .describe(
          "The GID of the time tracking entry (numeric string, e.g. `'1234567890123'`). Get GIDs from asana_get_time_tracking_entries.",
        ),
      opt_fields: z
        .string()
        .describe(
          "Comma-separated extra fields to include. Useful values: `gid,duration_minutes,entered_on,created_by.name,task.name,task.gid`. Default fields: gid, resource_type.",
        )
        .optional(),
    },
    handler: async (client, { time_tracking_entry_gid, ...opts }) =>
      jsonResponse(
        await client.getTimeTrackingEntry(time_tracking_entry_gid, opts),
      ),
  },
  {
    readOnly: false,
    name: "asana_update_time_tracking_entry",
    description:
      "Update the duration or date of an existing time tracking entry. Returns the updated entry with gid, duration_minutes, and entered_on.",
    inputSchema: {
      time_tracking_entry_gid: z
        .string()
        .describe(
          "The GID of the time tracking entry to update (numeric string, e.g. `'1234567890123'`).",
        ),
      duration_minutes: z
        .number()
        .describe("New duration in minutes.")
        .optional(),
      entered_on: z
        .string()
        .describe("New date in YYYY-MM-DD format.")
        .optional(),
      opt_fields: z
        .string()
        .describe(
          "Comma-separated fields to include in the response. Useful values: `gid,duration_minutes,entered_on,created_by.name`.",
        )
        .optional(),
    },
    handler: async (client, { time_tracking_entry_gid, opt_fields, ...data }) =>
      jsonResponse(
        await client.updateTimeTrackingEntry(time_tracking_entry_gid, data, {
          opt_fields,
        }),
      ),
  },
  {
    readOnly: false,
    name: "asana_delete_time_tracking_entry",
    description:
      "Permanently delete a time tracking entry from a task. This cannot be undone. Returns a success message.",
    inputSchema: {
      time_tracking_entry_gid: z
        .string()
        .describe(
          "The GID of the time tracking entry to delete (numeric string, e.g. `'1234567890123'`).",
        ),
    },
    handler: async (client, { time_tracking_entry_gid }) => {
      await client.deleteTimeTrackingEntry(time_tracking_entry_gid);
      return successResponse(
        `Successfully deleted time tracking entry ${time_tracking_entry_gid}`,
      );
    },
  },
];
