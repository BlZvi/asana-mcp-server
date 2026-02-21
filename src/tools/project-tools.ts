import { z } from "zod";
import { resolveWorkspace } from "../config.js";
import { jsonResponse, successResponse } from "./helpers.js";
import type { ToolEntry } from "./types.js";

export const projectTools: ToolEntry[] = [
  {
    name: "asana_search_projects",
    description:
      "Search for projects in a workspace by name using a regex pattern. Fetches all projects (auto-paginated) and filters client-side. Use `name_pattern: '.'` to list all projects. Returns array of objects with gid, name, resource_type by default.",
    readOnly: true,
    inputSchema: {
      workspace: z
        .string()
        .optional()
        .describe(
          "The GID of the workspace to search in (numeric string, e.g. `'1234567890123'`). Get it from asana_list_workspaces. Can be omitted if ASANA_DEFAULT_WORKSPACE_GID is set.",
        ),
      name_pattern: z
        .string()
        .describe(
          "Case-insensitive JavaScript regex to match project names. Use `'.'` to list all projects, or specific terms like `'Q4'` or `'sprint-d+'`.",
        ),
      archived: z
        .boolean()
        .optional()
        .describe(
          "Set to true to search only archived projects. Defaults to false (active projects only).",
        ),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated extra fields to include. Useful values: `color,archived,team.name,created_at,modified_at,due_on`. Default fields: gid, name, resource_type.",
        ),
    },
    handler: async (
      client,
      { workspace, name_pattern, archived = false, ...opts },
    ) =>
      jsonResponse(
        await client.searchProjects(
          resolveWorkspace(workspace),
          name_pattern,
          archived,
          opts,
        ),
      ),
  },
  {
    name: "asana_get_project",
    description:
      "Get full details for a project by GID. Returns gid, name, archived, color, created_at, modified_at, default_view, due_on, start_on, notes, privacy_setting, public, team.gid, and workspace.gid by default.",
    readOnly: true,
    inputSchema: {
      project_id: z
        .string()
        .describe(
          "The GID of the project (numeric string, e.g. `'1234567890123'`). Get it from asana_search_projects.",
        ),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated extra fields to include. Useful values: `team.name,workspace.name,current_status,members`. Default fields: gid, name, archived, color, created_at, modified_at, default_view, due_on, start_on, notes, privacy_setting, public, team.gid, workspace.gid.",
        ),
    },
    handler: async (client, { project_id, ...opts }) =>
      jsonResponse(await client.getProject(project_id, opts)),
  },
  {
    name: "asana_get_project_task_counts",
    description:
      "Get task counts for a project broken down by completion status. IMPORTANT: returns an empty object unless opt_fields specifies count fields explicitly. Always include opt_fields.",
    readOnly: true,
    inputSchema: {
      project_id: z
        .string()
        .describe(
          "The GID of the project (numeric string, e.g. `'1234567890123'`).",
        ),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Required to get any data. Recommended: `num_tasks,num_completed_tasks,num_incomplete_tasks,num_milestones,num_incomplete_milestones`.",
        ),
    },
    handler: async (client, { project_id, ...opts }) =>
      jsonResponse(await client.getProjectTaskCounts(project_id, opts)),
  },
  {
    name: "asana_get_project_sections",
    description:
      "List all sections in a project. Returns array of objects with gid, name, resource_type. Section GIDs are needed to place tasks in specific sections or to call section-specific tools.",
    readOnly: true,
    inputSchema: {
      project_id: z
        .string()
        .describe(
          "The GID of the project (numeric string, e.g. `'1234567890123'`).",
        ),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated extra fields to include. Default fields: gid, name, resource_type.",
        ),
    },
    handler: async (client, { project_id, ...opts }) =>
      jsonResponse(await client.getProjectSections(project_id, opts)),
  },
  {
    name: "asana_create_project",
    description:
      "Create a new project in a workspace. In organization workspaces (most), a team GID is required. Returns the created project object.",
    readOnly: false,
    inputSchema: {
      workspace: z
        .string()
        .optional()
        .describe(
          "The GID of the workspace (numeric string). Get it from asana_list_workspaces. Can be omitted if ASANA_DEFAULT_WORKSPACE_GID is set.",
        ),
      name: z.string().describe("Name of the project."),
      team: z
        .string()
        .optional()
        .describe(
          "The GID of the team to create the project under. Required for organization workspaces. Get team GIDs from asana_get_project's team.gid field on an existing project.",
        ),
      notes: z
        .string()
        .optional()
        .describe("Plain-text description or notes for the project."),
      color: z
        .string()
        .optional()
        .describe(
          "Color of the project. One of: dark-pink, dark-green, dark-blue, dark-red, dark-teal, dark-brown, dark-orange, dark-purple, dark-warm-gray, light-pink, light-green, light-blue, light-red, light-teal, light-brown, light-orange, light-purple, light-warm-gray.",
        ),
      privacy_setting: z
        .string()
        .optional()
        .describe(
          "Privacy setting. One of: `public_to_workspace` (anyone in org can find it), `private_to_team` (only team members), `private` (invite-only).",
        ),
      default_view: z
        .string()
        .optional()
        .describe(
          "Default view when opening the project. One of: list, board, calendar, timeline.",
        ),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated fields to include in the response. Default fields: gid, name, resource_type.",
        ),
    },
    handler: async (client, { workspace, opt_fields, ...data }) =>
      jsonResponse(
        await client.createProject(
          { ...data, workspace: resolveWorkspace(workspace) },
          { opt_fields },
        ),
      ),
  },
  {
    name: "asana_update_project",
    description:
      "Update fields on an existing project. Only supply the fields you want to change. Returns the updated project object.",
    readOnly: false,
    inputSchema: {
      project_gid: z
        .string()
        .describe(
          "The GID of the project to update (numeric string, e.g. `'1234567890123'`).",
        ),
      name: z.string().optional().describe("New name for the project."),
      notes: z.string().optional().describe("New plain-text description."),
      html_notes: z
        .string()
        .optional()
        .describe(
          "New HTML-formatted description. Follows the same tag restrictions as html_notes on tasks.",
        ),
      color: z
        .string()
        .optional()
        .describe(
          "New color. One of: dark-pink, dark-green, dark-blue, dark-red, dark-teal, dark-brown, dark-orange, dark-purple, dark-warm-gray, light-pink, light-green, light-blue, light-red, light-teal, light-brown, light-orange, light-purple, light-warm-gray.",
        ),
      due_on: z
        .string()
        .optional()
        .describe("New due date in YYYY-MM-DD format."),
      start_on: z
        .string()
        .optional()
        .describe("New start date in YYYY-MM-DD format."),
      archived: z
        .boolean()
        .optional()
        .describe("Set to true to archive the project, false to unarchive."),
      public: z
        .boolean()
        .optional()
        .describe("Whether the project is publicly visible in the workspace."),
      default_view: z
        .string()
        .optional()
        .describe("New default view. One of: list, board, calendar, timeline."),
      opt_fields: z
        .string()
        .optional()
        .describe("Comma-separated fields to include in the response."),
    },
    handler: async (client, { project_gid, opt_fields, ...data }) =>
      jsonResponse(
        await client.updateProject(project_gid, data, { opt_fields }),
      ),
  },
  {
    name: "asana_delete_project",
    description:
      "Permanently delete a project and all its tasks. This action cannot be undone.",
    readOnly: false,
    inputSchema: {
      project_gid: z
        .string()
        .describe(
          "The GID of the project to delete (numeric string, e.g. `'1234567890123'`).",
        ),
    },
    handler: async (client, { project_gid }) => {
      await client.deleteProject(project_gid);
      return successResponse(`Successfully deleted project ${project_gid}`);
    },
  },
];
