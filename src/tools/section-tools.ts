import { z } from "zod";
import { jsonResponse, successResponse } from "./helpers.js";
import type { ToolEntry } from "./types.js";

export const sectionTools: ToolEntry[] = [
  {
    readOnly: true,
    name: "asana_get_section",
    description:
      "Get details for a single section by GID. Returns the section's name, created_at, and parent project. Use asana_get_project_sections to list all sections in a project and find GIDs.",
    inputSchema: {
      section_gid: z
        .string()
        .describe(
          "The GID of the section (numeric string, e.g. `'1234567890123'`). Get section GIDs from asana_get_project_sections.",
        ),
      opt_fields: z
        .string()
        .describe(
          "Comma-separated extra fields to include. Useful values: `gid,name,created_at,project.name,resource_type`. Default fields: gid, resource_type.",
        )
        .optional(),
    },
    handler: async (client, { section_gid, ...opts }) =>
      jsonResponse(await client.getSection(section_gid, opts)),
  },
  {
    readOnly: false,
    name: "asana_create_section",
    description:
      "Create a new section in a project. Sections appear as column headers in board view or group headers in list view. Returns the created section object with gid and name. Use insert_before or insert_after to control placement.",
    inputSchema: {
      project_gid: z
        .string()
        .describe(
          "The GID of the project to add the section to (numeric string, e.g. `'1234567890123'`).",
        ),
      name: z.string().describe("Name of the new section."),
      insert_before: z
        .string()
        .describe(
          "GID of an existing section to insert the new section before. Cannot be used with insert_after.",
        )
        .optional(),
      insert_after: z
        .string()
        .describe(
          "GID of an existing section to insert the new section after. Cannot be used with insert_before.",
        )
        .optional(),
      opt_fields: z
        .string()
        .describe(
          "Comma-separated fields to include in the response. Useful values: `gid,name,created_at`.",
        )
        .optional(),
    },
    handler: async (client, { project_gid, opt_fields, ...data }) =>
      jsonResponse(
        await client.createSection(project_gid, data, { opt_fields }),
      ),
  },
  {
    readOnly: false,
    name: "asana_update_section",
    description:
      "Rename an existing section. Returns the updated section object with gid and name. To reorder sections, use asana_move_section instead.",
    inputSchema: {
      section_gid: z
        .string()
        .describe(
          "The GID of the section to update (numeric string, e.g. `'1234567890123'`).",
        ),
      name: z.string().describe("New name for the section."),
      opt_fields: z
        .string()
        .describe(
          "Comma-separated fields to include in the response. Useful values: `gid,name,created_at`.",
        )
        .optional(),
    },
    handler: async (client, { section_gid, opt_fields, ...data }) =>
      jsonResponse(
        await client.updateSection(section_gid, data, { opt_fields }),
      ),
  },
  {
    readOnly: false,
    name: "asana_delete_section",
    description:
      "Delete a section from a project. Tasks in the deleted section are moved to the project's default (first) section — they are NOT deleted. The last remaining section in a project cannot be deleted. Returns a success message.",
    inputSchema: {
      section_gid: z
        .string()
        .describe(
          "The GID of the section to delete (numeric string, e.g. `'1234567890123'`).",
        ),
    },
    handler: async (client, { section_gid }) => {
      await client.deleteSection(section_gid);
      return successResponse(`Successfully deleted section ${section_gid}`);
    },
  },
  {
    readOnly: false,
    name: "asana_move_section",
    description:
      "Reorder a section within a project by moving it before or after another section. Returns an empty object `{}` on success. To rename a section, use asana_update_section.",
    inputSchema: {
      project_gid: z
        .string()
        .describe(
          "The GID of the project containing the section (numeric string, e.g. `'1234567890123'`).",
        ),
      section_gid: z
        .string()
        .describe(
          "The GID of the section to move (numeric string, e.g. `'1234567890123'`).",
        ),
      before_section: z
        .string()
        .describe(
          "GID of the section to move before. Cannot be used with after_section.",
        )
        .optional(),
      after_section: z
        .string()
        .describe(
          "GID of the section to move after. Cannot be used with before_section.",
        )
        .optional(),
    },
    handler: async (
      client,
      { project_gid, section_gid, before_section, after_section },
    ) => {
      const data: any = { section: section_gid };
      if (before_section) data.before_section = before_section;
      if (after_section) data.after_section = after_section;
      return jsonResponse(await client.moveSection(project_gid, data));
    },
  },
  {
    readOnly: false,
    name: "asana_add_task_to_section",
    description:
      "Move a task into a specific section within a project. The task is placed at the top of the section unless insert_before or insert_after is specified. Returns a success message. Prefer using the `memberships` parameter in asana_create_task to place tasks in sections at creation time.",
    inputSchema: {
      section_gid: z
        .string()
        .describe(
          "The GID of the destination section (numeric string, e.g. `'1234567890123'`). Get section GIDs from asana_get_project_sections.",
        ),
      task_gid: z
        .string()
        .describe(
          "The GID of the task to move into the section (numeric string, e.g. `'1234567890123'`).",
        ),
      insert_before: z
        .string()
        .describe(
          "GID of a task already in the section to insert this task before.",
        )
        .optional(),
      insert_after: z
        .string()
        .describe(
          "GID of a task already in the section to insert this task after.",
        )
        .optional(),
    },
    handler: async (
      client,
      { section_gid, task_gid, insert_before, insert_after },
    ) => {
      const data: any = { task: task_gid };
      if (insert_before) data.insert_before = insert_before;
      if (insert_after) data.insert_after = insert_after;
      await client.addTaskToSection(section_gid, data);
      return successResponse(
        `Successfully added task ${task_gid} to section ${section_gid}`,
      );
    },
  },
];
