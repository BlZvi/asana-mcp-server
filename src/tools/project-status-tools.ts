import { z } from "zod";
import { jsonResponse } from "./helpers.js";
import type { ToolEntry } from "./types.js";

export const projectStatusTools: ToolEntry[] = [
  {
    name: "asana_get_project_status",
    description:
      "Get a single project status update by its GID. Returns the status object including text, color (green/yellow/red), title, author, and created_at.",
    readOnly: true,
    inputSchema: {
      project_status_gid: z
        .string()
        .describe(
          "The GID of the project status update (numeric string, e.g. `'1234567890123'`). Get status GIDs from asana_get_project_statuses.",
        ),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated extra fields to include. Useful values: `gid,text,color,title,author.name,created_at,html_text`. Default fields: gid, text, resource_type.",
        ),
    },
    handler: async (client, { project_status_gid, ...opts }) =>
      jsonResponse(await client.getProjectStatus(project_status_gid, opts)),
  },
  {
    name: "asana_get_project_statuses",
    description:
      "List all status updates for a project, ordered newest first. Status updates are the periodic health check-ins (green/yellow/red) visible in the project's status tab. Returns an array of status objects.",
    readOnly: true,
    inputSchema: {
      project_gid: z
        .string()
        .describe(
          "The GID of the project (numeric string, e.g. `'1234567890123'`).",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Results per page (1-100)."),
      offset: z
        .string()
        .optional()
        .describe(
          "Pagination offset token from a previous response's next_page.offset.",
        ),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated extra fields to include. Useful values: `gid,text,color,title,author.name,created_at`. Default fields: gid, text, resource_type.",
        ),
    },
    handler: async (client, { project_gid, ...opts }) =>
      jsonResponse(
        await client.getProjectStatusesForProject(project_gid, opts),
      ),
  },
  {
    name: "asana_create_project_status",
    description:
      "Create a new status update for a project (the health check-in shown in the project's status tab). Returns the created status object. Use `color` to visually signal project health.",
    readOnly: false,
    inputSchema: {
      project_gid: z
        .string()
        .describe(
          "The GID of the project (numeric string, e.g. `'1234567890123'`).",
        ),
      text: z.string().describe("Plain-text content of the status update."),
      color: z
        .enum(["green", "yellow", "red"])
        .optional()
        .describe(
          "Health indicator color: `green` = on track, `yellow` = at risk, `red` = off track.",
        ),
      title: z
        .string()
        .optional()
        .describe(
          "Short title shown prominently in the UI alongside the color indicator.",
        ),
      html_text: z
        .string()
        .optional()
        .describe(
          "HTML-formatted content. Follows the same tag restrictions as html_notes on tasks.",
        ),
      opt_fields: z
        .string()
        .optional()
        .describe("Comma-separated fields to include in the response."),
    },
    handler: async (client, { project_gid, ...statusData }) =>
      jsonResponse(await client.createProjectStatus(project_gid, statusData)),
  },
  {
    name: "asana_delete_project_status",
    description:
      "Permanently delete a project status update. This cannot be undone.",
    readOnly: false,
    inputSchema: {
      project_status_gid: z
        .string()
        .describe(
          "The GID of the project status update to delete (numeric string, e.g. `'1234567890123'`).",
        ),
    },
    handler: async (client, { project_status_gid }) =>
      jsonResponse(await client.deleteProjectStatus(project_status_gid)),
  },
];
