import { z } from "zod";
import { validateAsanaXml } from "../asana-validate-xml.js";
import {
  jsonResponse,
  xmlPreValidationErrorResponse,
  xmlValidButErrorResponse,
} from "./helpers.js";
import type { ToolEntry } from "./types.js";

export const storyTools: ToolEntry[] = [
  {
    readOnly: true,
    name: "asana_get_task_stories",
    description:
      "Get all stories (comments and system activity) for a task, ordered oldest first. Returns an array of story objects — each has `type: 'comment'` (user-added comments) or `type: 'system'` (auto-generated activity like assignments and status changes). Filter for `type === 'comment'` to get only user comments.",
    inputSchema: {
      task_id: z
        .string()
        .describe(
          "The GID of the task to fetch stories for (numeric string, e.g. `'19234567890123'`).",
        ),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated extra fields to include. Useful values: `gid,text,html_text,type,created_at,created_by.name`. Default fields: gid, resource_type.",
        ),
    },
    handler: async (client, { task_id, ...opts }) =>
      jsonResponse(await client.getStoriesForTask(task_id, opts)),
  },
  {
    readOnly: false,
    name: "asana_create_task_story",
    description:
      "Add a comment to a task. Provide either `text` (plain text) or `html_text` (formatted). If both are given, `html_text` is used and `text` is ignored. Returns the created story object including gid, text, created_at, created_by.",
    inputSchema: {
      task_id: z
        .string()
        .describe(
          "The GID of the task to comment on (numeric string, e.g. `'19234567890123'`).",
        ),
      text: z
        .string()
        .optional()
        .describe(
          "Plain-text content of the comment. Use this for simple comments without formatting.",
        ),
      html_text: z
        .string()
        .optional()
        .describe(
          'HTML-formatted comment. Root element must be `<body>`. Allowed tags: `<h1>`, `<h2>`, `<ol>`, `<ul>`, `<li>`, `<strong>`, `<em>`, `<u>`, `<s>`, `<code>`, `<pre>`, `<blockquote>`, `<a data-asana-type="" data-asana-gid="">`, `<hr>`, `<img>`, `<table>`, `<tr>`, `<td>`. No other tags. Use `\\n` for line breaks, not after `<body>`.',
        ),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated extra fields to include. Useful values: `gid,text,html_text,type,created_at,created_by.name`.",
        ),
    },
    handler: async (client, args) => {
      const { task_id, text, html_text, ...opts } = args;

      let warning: string | null = null;
      let effectiveText = text;
      const effectiveHtmlText = html_text;

      // If both are provided, prefer html_text and warn
      if (text && html_text) {
        warning =
          "Warning: Both 'text' and 'html_text' were provided. The Asana API does not support both simultaneously. Using 'html_text' and ignoring 'text'. Use 'html_text' for formatted content with @mentions, links, and styling. Use 'text' for plain text comments.";
        effectiveText = null;
      }

      // Pre-validate HTML if provided
      if (effectiveHtmlText) {
        const xmlValidationErrors = validateAsanaXml(effectiveHtmlText);
        if (xmlValidationErrors.length > 0) {
          return xmlPreValidationErrorResponse(xmlValidationErrors);
        }
      }

      try {
        const response = await client.createTaskStory(
          task_id,
          effectiveText,
          opts,
          effectiveHtmlText,
        );
        const result = warning ? { warning, result: response } : response;
        return jsonResponse(result);
      } catch (error: any) {
        if (
          html_text &&
          error instanceof Error &&
          error.message.includes("400")
        ) {
          return xmlValidButErrorResponse(error);
        }
        throw error;
      }
    },
  },
];
