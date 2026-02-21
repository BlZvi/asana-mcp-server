import { z } from "zod";
import { resolveWorkspace } from "../config.js";
import { jsonResponse } from "./helpers.js";
import type { ToolEntry } from "./types.js";

export const tagTools: ToolEntry[] = [
  {
    readOnly: true,
    name: "asana_get_tag",
    description:
      "Get full details for a single tag by GID. Returns the tag's name, color, notes, followers, and workspace. Use asana_get_tags_for_workspace to find a tag GID by name.",
    inputSchema: {
      tag_gid: z
        .string()
        .describe(
          "The GID of the tag (numeric string, e.g. `'1234567890123'`). Get tag GIDs from asana_get_tags_for_workspace or asana_get_tags_for_task.",
        ),
      opt_fields: z
        .string()
        .describe(
          "Comma-separated extra fields to include. Useful values: `gid,name,color,notes,created_at,workspace.name,followers.name`. Default fields: gid, resource_type.",
        )
        .optional(),
    },
    handler: async (client, { tag_gid, ...opts }) =>
      jsonResponse(await client.getTag(tag_gid, opts)),
  },
  {
    readOnly: true,
    name: "asana_get_tags_for_task",
    description:
      "List all tags currently applied to a task. Returns an array of tag objects with gid, name, and color. Tags are workspace-scoped labels used to categorize tasks across projects.",
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
          "Comma-separated extra fields to include. Useful values: `gid,name,color,notes`. Default fields: gid, resource_type.",
        )
        .optional(),
    },
    handler: async (client, { task_gid, ...opts }) =>
      jsonResponse(await client.getTagsForTask(task_gid, opts)),
  },
  {
    readOnly: true,
    name: "asana_get_tags_for_workspace",
    description:
      "List all tags in a workspace. Tags are workspace-scoped and can be applied to any task. Returns an array of tag objects. Use limit and offset for pagination on large workspaces.",
    inputSchema: {
      workspace_gid: z
        .string()
        .optional()
        .describe(
          "The GID of the workspace (numeric string, e.g. `'1234567890123'`). Get it from asana_list_workspaces. Can be omitted if ASANA_DEFAULT_WORKSPACE_GID is set.",
        ),
      limit: z.number().int().describe("Results per page (1-100).").optional(),
      offset: z
        .string()
        .describe(
          "Pagination offset token from a previous response's next_page.offset.",
        )
        .optional(),
      opt_fields: z
        .string()
        .describe(
          "Comma-separated extra fields to include. Useful values: `gid,name,color,notes,created_at`. Default fields: gid, resource_type.",
        )
        .optional(),
    },
    handler: async (client, { workspace_gid, ...opts }) =>
      jsonResponse(
        await client.getTagsForWorkspace(resolveWorkspace(workspace_gid), opts),
      ),
  },
  {
    readOnly: false,
    name: "asana_update_tag",
    description:
      "Update the name, color, or notes of an existing tag. Only supply the fields you want to change. Returns the updated tag object.",
    inputSchema: {
      tag_gid: z
        .string()
        .describe(
          "The GID of the tag to update (numeric string, e.g. `'1234567890123'`).",
        ),
      name: z.string().describe("New name for the tag.").optional(),
      color: z
        .string()
        .describe(
          "New color. One of: dark-pink, dark-green, dark-blue, dark-red, dark-teal, dark-brown, dark-orange, dark-purple, dark-warm-gray, light-pink, light-green, light-blue, light-red, light-teal, light-brown, light-orange, light-purple, light-warm-gray.",
        )
        .optional(),
      notes: z
        .string()
        .describe("New notes/description for the tag.")
        .optional(),
      opt_fields: z
        .string()
        .describe(
          "Comma-separated fields to include in the response. Useful values: `gid,name,color,notes`.",
        )
        .optional(),
    },
    handler: async (client, { tag_gid, opt_fields, ...tagData }) =>
      jsonResponse(await client.updateTag(tag_gid, tagData, { opt_fields })),
  },
  {
    readOnly: false,
    name: "asana_delete_tag",
    description:
      "Permanently delete a tag from the workspace. This does NOT remove the tag from tasks — it just deletes the tag itself. Returns an empty object `{}` on success.",
    inputSchema: {
      tag_gid: z
        .string()
        .describe(
          "The GID of the tag to delete (numeric string, e.g. `'1234567890123'`).",
        ),
    },
    handler: async (client, { tag_gid }) =>
      jsonResponse(await client.deleteTag(tag_gid)),
  },
  {
    readOnly: true,
    name: "asana_get_tasks_for_tag",
    description:
      "List all tasks that have a specific tag applied. Returns an array of task objects. Useful for finding all tasks in a workspace labeled with a particular tag, regardless of project.",
    inputSchema: {
      tag_gid: z
        .string()
        .describe(
          "The GID of the tag (numeric string, e.g. `'1234567890123'`). Get tag GIDs from asana_get_tags_for_workspace.",
        ),
      opt_fields: z
        .string()
        .describe(
          "Comma-separated extra fields to include. Useful values: `gid,name,completed,assignee.name,due_on,projects.name`. Default fields: gid, resource_type.",
        )
        .optional(),
      limit: z.number().int().describe("Results per page (1-100).").optional(),
      offset: z
        .string()
        .describe(
          "Pagination offset token from a previous response's next_page.offset.",
        )
        .optional(),
    },
    handler: async (client, { tag_gid, ...opts }) =>
      jsonResponse(await client.getTasksForTag(tag_gid, opts)),
  },
  {
    readOnly: false,
    name: "asana_create_tag_for_workspace",
    description:
      "Create a new tag in a workspace. Tags are workspace-scoped and can be applied to any task. Returns the created tag object. After creating, use asana_add_tag_to_task to apply it.",
    inputSchema: {
      workspace_gid: z
        .string()
        .optional()
        .describe(
          "The GID of the workspace to create the tag in (numeric string, e.g. `'1234567890123'`). Get it from asana_list_workspaces. Can be omitted if ASANA_DEFAULT_WORKSPACE_GID is set.",
        ),
      name: z.string().describe("Name of the new tag."),
      followers: z
        .array(z.string())
        .describe(
          'Optional array of user identifiers to add as followers. Each can be `"me"`, an email address, or a user GID.',
        )
        .optional(),
      color: z
        .string()
        .describe(
          "Optional color. One of: dark-pink, dark-green, dark-blue, dark-red, dark-teal, dark-brown, dark-orange, dark-purple, dark-warm-gray, light-pink, light-green, light-blue, light-red, light-teal, light-brown, light-orange, light-purple, light-warm-gray.",
        )
        .optional(),
      notes: z
        .string()
        .describe("Optional description/notes for the tag.")
        .optional(),
      opt_fields: z
        .string()
        .describe(
          "Comma-separated fields to include in the response. Useful values: `gid,name,color,notes,created_at`.",
        )
        .optional(),
    },
    handler: async (client, { workspace_gid, opt_fields, ...data }) =>
      jsonResponse(
        await client.createTagForWorkspace(
          resolveWorkspace(workspace_gid),
          data,
          { opt_fields },
        ),
      ),
  },
  {
    readOnly: false,
    name: "asana_add_tag_to_task",
    description:
      "Apply a tag to a task. Returns an empty object `{}` on success. Use asana_get_tags_for_workspace to find the tag GID first. To remove the tag, use asana_remove_tag_from_task.",
    inputSchema: {
      task_gid: z
        .string()
        .describe(
          "The GID of the task to tag (numeric string, e.g. `'1234567890123'`).",
        ),
      tag_gid: z
        .string()
        .describe(
          "The GID of the tag to apply (numeric string, e.g. `'1234567890123'`).",
        ),
    },
    handler: async (client, { task_gid, tag_gid }) =>
      jsonResponse(await client.addTagToTask(task_gid, tag_gid)),
  },
  {
    readOnly: false,
    name: "asana_remove_tag_from_task",
    description:
      "Remove a tag from a task (does not delete the tag itself). Returns an empty object `{}` on success.",
    inputSchema: {
      task_gid: z
        .string()
        .describe(
          "The GID of the task to remove the tag from (numeric string, e.g. `'1234567890123'`).",
        ),
      tag_gid: z
        .string()
        .describe(
          "The GID of the tag to remove (numeric string, e.g. `'1234567890123'`).",
        ),
    },
    handler: async (client, { task_gid, tag_gid }) =>
      jsonResponse(await client.removeTagFromTask(task_gid, tag_gid)),
  },
];
