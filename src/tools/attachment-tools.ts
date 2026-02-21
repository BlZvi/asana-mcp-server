import { z } from "zod";
import { jsonResponse, successResponse } from "./helpers.js";
import type { ToolEntry } from "./types.js";

export const attachmentTools: ToolEntry[] = [
  {
    readOnly: true,
    name: "asana_get_attachments_for_object",
    description:
      "List all attachments on a task or project. Returns gid, name, resource_subtype, created_at, and host for each attachment. Use asana_get_attachment to get the download URL for a specific file.",
    inputSchema: {
      parent: z
        .string()
        .describe(
          "The GID of the task or project to list attachments for (numeric string, e.g. `'1234567890123'`).",
        ),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated extra fields to include. Useful values: `gid,name,resource_subtype,created_at,host,size,download_url,view_url,permalink_url,parent.name`. Default fields: gid, resource_type, name.",
        ),
      limit: z.number().int().optional().describe("Results per page (1-100)."),
      offset: z
        .string()
        .optional()
        .describe(
          "Pagination offset token from a previous response's next_page.offset.",
        ),
    },
    handler: async (client, { parent, ...opts }) =>
      jsonResponse(await client.getAttachmentsForObject(parent, opts)),
  },
  {
    readOnly: true,
    name: "asana_get_attachment",
    description:
      "Get full details for a single attachment by GID. Returns name, download_url, view_url, size, host, created_at, and parent. Use the download_url to access the file. Use asana_get_attachments_for_object to list all attachments on a task.",
    inputSchema: {
      attachment_gid: z
        .string()
        .describe(
          "The GID of the attachment (numeric string, e.g. `'1234567890123'`). Get attachment GIDs from asana_get_attachments_for_object.",
        ),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated extra fields to include. Useful values: `gid,name,resource_subtype,created_at,host,size,download_url,view_url,permalink_url,parent.name,parent.gid`. Default fields: gid, resource_type, name.",
        ),
    },
    handler: async (client, { attachment_gid, ...opts }) =>
      jsonResponse(await client.getAttachment(attachment_gid, opts)),
  },
  {
    readOnly: false,
    name: "asana_delete_attachment",
    description:
      "Delete an attachment from a task or project. Returns an empty object `{}` on success. This action is permanent. Get attachment GIDs from asana_get_attachments_for_object.",
    inputSchema: {
      attachment_gid: z
        .string()
        .describe(
          "The GID of the attachment to delete (numeric string, e.g. `'1234567890123'`).",
        ),
    },
    handler: async (client, { attachment_gid }) =>
      successResponse(`Attachment ${attachment_gid} deleted successfully`),
  },
  {
    readOnly: false,
    name: "asana_create_attachment_for_object",
    description:
      "Attach an external URL link to a task or project. Creates a named link that appears in the task's attachments panel. Use this to link GitHub PRs, documents, design files, or any external resource to a task. Note: file upload (binary) is not supported through this tool — only URL-based (external) attachments.",
    inputSchema: {
      parent: z
        .string()
        .describe(
          "The GID of the task or project to attach the URL to (numeric string, e.g. `'1234567890123'`).",
        ),
      url: z
        .string()
        .describe("The URL to attach. Must be a valid URL (e.g. `https://...`)."),
      name: z
        .string()
        .optional()
        .describe(
          "Display name for the link. Shown in the attachments panel. Defaults to the URL if omitted.",
        ),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated extra fields to include in the response. Useful values: `gid,name,resource_subtype,host,view_url,permalink_url`.",
        ),
    },
    handler: async (client, { parent, url, name, opt_fields }) =>
      jsonResponse(
        await client.createAttachmentForObject(
          parent,
          { resource_subtype: "external", url, name },
          { opt_fields },
        ),
      ),
  },
];
