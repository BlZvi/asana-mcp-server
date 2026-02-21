import { z } from "zod";
import { resolveWorkspace } from "../config.js";
import { jsonResponse, successResponse } from "./helpers.js";
import type { ToolEntry } from "./types.js";

export const customFieldTools: ToolEntry[] = [
  {
    readOnly: true,
    name: "asana_get_custom_fields_for_workspace",
    description:
      "List all custom field definitions in a workspace. Returns gid, name, type, and enum_options for each field. Use this to discover available custom fields and their GIDs before reading or writing custom field values on tasks.",
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
          "Comma-separated extra fields to include. Useful values: `gid,name,type,description,enum_options,is_global_to_workspace,precision,format`. Default fields: gid, resource_type, name.",
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
        await client.getCustomFieldsForWorkspace(
          resolveWorkspace(workspace),
          opts,
        ),
      ),
  },
  {
    readOnly: true,
    name: "asana_get_custom_field",
    description:
      "Get full details for a custom field by GID. Returns name, type, description, enum_options (with gid, name, color, enabled), precision, and format. Use this to get enum option GIDs before setting custom field values on tasks.",
    inputSchema: {
      custom_field_gid: z
        .string()
        .describe(
          "The GID of the custom field (numeric string, e.g. `'1234567890123'`). Get custom field GIDs from asana_get_custom_fields_for_workspace or from the `custom_fields` array on a task.",
        ),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated extra fields to include. Useful values: `gid,name,type,description,enum_options,is_global_to_workspace,precision,format,currency_code,custom_label`. Default fields: gid, resource_type, name, type.",
        ),
    },
    handler: async (client, { custom_field_gid, ...opts }) =>
      jsonResponse(await client.getCustomField(custom_field_gid, opts)),
  },
  {
    readOnly: false,
    name: "asana_create_custom_field",
    description:
      "Create a new custom field in a workspace. Supported types: `text`, `number`, `enum`, `multi_enum`, `date`, `people`. For `enum`/`multi_enum` fields, add options after creation using asana_create_enum_option. Returns the created custom field object.",
    inputSchema: {
      workspace: z
        .string()
        .optional()
        .describe(
          "The GID of the workspace (numeric string, e.g. `'1234567890123'`). Can be omitted if ASANA_DEFAULT_WORKSPACE_GID is set.",
        ),
      name: z.string().describe("Name of the custom field."),
      type: z
        .enum(["text", "number", "enum", "multi_enum", "date", "people"])
        .describe(
          "Field type. One of: `text`, `number`, `enum`, `multi_enum`, `date`, `people`. Cannot be changed after creation.",
        ),
      description: z
        .string()
        .optional()
        .describe("Optional description of the custom field."),
      precision: z
        .number()
        .int()
        .optional()
        .describe(
          "For `number` fields: decimal places to display (0-6). Defaults to 0.",
        ),
      format: z
        .string()
        .optional()
        .describe(
          "For `number` fields: display format. One of: `none`, `currency`, `percentage`, `custom`.",
        ),
      currency_code: z
        .string()
        .optional()
        .describe(
          "For `number` fields with `currency` format: ISO 4217 currency code (e.g. `'USD'`).",
        ),
      custom_label: z
        .string()
        .optional()
        .describe("For `number` fields with `custom` format: the label text."),
      is_global_to_workspace: z
        .boolean()
        .optional()
        .describe(
          "Set to true to make this field available across all projects in the workspace.",
        ),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated fields to include in the response. Useful values: `gid,name,type,description,enum_options`.",
        ),
    },
    handler: async (client, { workspace, opt_fields, ...data }) =>
      jsonResponse(
        await client.createCustomField(
          { ...data, workspace: resolveWorkspace(workspace) },
          { opt_fields },
        ),
      ),
  },
  {
    readOnly: false,
    name: "asana_update_custom_field",
    description:
      "Update a custom field's name, description, or settings. Note: the `type` field cannot be changed after creation. To add/update enum options, use asana_create_enum_option or asana_update_enum_option. Returns the updated custom field.",
    inputSchema: {
      custom_field_gid: z
        .string()
        .describe(
          "The GID of the custom field to update (numeric string, e.g. `'1234567890123'`).",
        ),
      name: z.string().optional().describe("New name for the custom field."),
      description: z
        .string()
        .optional()
        .describe("New description for the custom field."),
      precision: z
        .number()
        .int()
        .optional()
        .describe("For `number` fields: decimal places (0-6)."),
      format: z
        .string()
        .optional()
        .describe(
          "For `number` fields: display format. One of: `none`, `currency`, `percentage`, `custom`.",
        ),
      currency_code: z
        .string()
        .optional()
        .describe("For `number` fields with `currency` format: ISO 4217 code."),
      custom_label: z
        .string()
        .optional()
        .describe("For `number` fields with `custom` format: the label text."),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated fields to include in the response. Useful values: `gid,name,type,description,enum_options`.",
        ),
    },
    handler: async (client, { custom_field_gid, opt_fields, ...data }) =>
      jsonResponse(
        await client.updateCustomField(custom_field_gid, data, { opt_fields }),
      ),
  },
  {
    readOnly: false,
    name: "asana_delete_custom_field",
    description:
      "Permanently delete a custom field from the workspace. This removes the field from all tasks and projects. Locked fields can only be deleted by the user who locked them. Returns an empty object `{}` on success.",
    inputSchema: {
      custom_field_gid: z
        .string()
        .describe(
          "The GID of the custom field to delete (numeric string, e.g. `'1234567890123'`).",
        ),
    },
    handler: async (client, { custom_field_gid }) =>
      successResponse(
        `Custom field ${custom_field_gid} deleted successfully`,
      ),
  },
  {
    readOnly: false,
    name: "asana_create_enum_option",
    description:
      "Add a new option to an enum or multi_enum custom field. New options are appended to the end of the list by default. Returns the created enum option with its GID. Use the GID to set this option on tasks via asana_update_task.",
    inputSchema: {
      custom_field_gid: z
        .string()
        .describe(
          "The GID of the enum or multi_enum custom field to add an option to (numeric string, e.g. `'1234567890123'`).",
        ),
      name: z.string().describe("Display name for the new enum option."),
      color: z
        .string()
        .optional()
        .describe(
          "Color for the option. One of: `none`, `red`, `orange`, `yellow-orange`, `yellow`, `yellow-green`, `green`, `blue-green`, `aqua`, `blue`, `indigo`, `purple`, `magenta`, `hot-pink`, `pink`, `cool-gray`.",
        ),
      enabled: z
        .boolean()
        .optional()
        .describe(
          "Whether the option is enabled (visible to users). Defaults to true.",
        ),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated fields to include in the response. Useful values: `gid,name,color,enabled`.",
        ),
    },
    handler: async (client, { custom_field_gid, opt_fields, ...data }) =>
      jsonResponse(
        await client.createEnumOption(custom_field_gid, data, { opt_fields }),
      ),
  },
  {
    readOnly: false,
    name: "asana_update_enum_option",
    description:
      "Update an enum option's name, color, or enabled status. Use this to rename options, change their color, or disable/enable them. Disabled options are hidden from users but existing values are preserved. Returns the updated enum option.",
    inputSchema: {
      enum_option_gid: z
        .string()
        .describe(
          "The GID of the enum option to update (numeric string, e.g. `'1234567890123'`). Get enum option GIDs from asana_get_custom_field.",
        ),
      name: z
        .string()
        .optional()
        .describe("New display name for the enum option."),
      color: z
        .string()
        .optional()
        .describe(
          "New color. One of: `none`, `red`, `orange`, `yellow-orange`, `yellow`, `yellow-green`, `green`, `blue-green`, `aqua`, `blue`, `indigo`, `purple`, `magenta`, `hot-pink`, `pink`, `cool-gray`.",
        ),
      enabled: z
        .boolean()
        .optional()
        .describe(
          "Set to false to disable the option (hide from users without deleting).",
        ),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated fields to include in the response. Useful values: `gid,name,color,enabled`.",
        ),
    },
    handler: async (client, { enum_option_gid, opt_fields, ...data }) =>
      jsonResponse(
        await client.updateEnumOption(enum_option_gid, data, { opt_fields }),
      ),
  },
];
