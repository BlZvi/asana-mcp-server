import { z } from "zod";
import { validateAsanaXml } from "../asana-validate-xml.js";
import { resolveWorkspace } from "../config.js";
import {
  jsonResponse,
  successResponse,
  xmlPreValidationErrorResponse,
  xmlValidButErrorResponse,
} from "./helpers.js";
import type { ToolEntry } from "./types.js";

export const taskTools: ToolEntry[] = [
  {
    readOnly: true,
    name: "asana_search_tasks",
    description:
      "Full-text search for tasks across a workspace with advanced filters. Searches task names AND descriptions. Returns up to 100 results (no auto-pagination). Prefer filters like `projects_any`, `assignee_any`, `completed`, or `due_on_before` to narrow results. Returns minimal fields by default — always use opt_fields.",
    inputSchema: {
      workspace: z
        .string()
        .optional()
        .describe(
          "The GID of the workspace to search in (numeric string, e.g. `'19234567890123'`). Get it from asana_list_workspaces. Can be omitted if ASANA_DEFAULT_WORKSPACE_GID is set.",
        ),
      text: z
        .string()
        .optional()
        .describe("Text to search for in task names and descriptions"),
      resource_subtype: z
        .string()
        .optional()
        .describe("Filter by task subtype (e.g. milestone)"),
      portfolios_any: z
        .string()
        .optional()
        .describe("Comma-separated list of portfolio IDs"),
      assignee_any: z
        .string()
        .optional()
        .describe("Comma-separated list of user IDs"),
      assignee_not: z
        .string()
        .optional()
        .describe("Comma-separated list of user IDs to exclude"),
      projects_any: z
        .string()
        .optional()
        .describe("Comma-separated list of project IDs"),
      projects_not: z
        .string()
        .optional()
        .describe("Comma-separated list of project IDs to exclude"),
      projects_all: z
        .string()
        .optional()
        .describe("Comma-separated list of project IDs that must all match"),
      sections_any: z
        .string()
        .optional()
        .describe("Comma-separated list of section IDs"),
      sections_not: z
        .string()
        .optional()
        .describe("Comma-separated list of section IDs to exclude"),
      sections_all: z
        .string()
        .optional()
        .describe("Comma-separated list of section IDs that must all match"),
      tags_any: z
        .string()
        .optional()
        .describe("Comma-separated list of tag IDs"),
      tags_not: z
        .string()
        .optional()
        .describe("Comma-separated list of tag IDs to exclude"),
      tags_all: z
        .string()
        .optional()
        .describe("Comma-separated list of tag IDs that must all match"),
      teams_any: z
        .string()
        .optional()
        .describe("Comma-separated list of team IDs"),
      followers_any: z
        .string()
        .optional()
        .describe("Comma-separated list of user IDs"),
      followers_not: z
        .string()
        .optional()
        .describe("Comma-separated list of user IDs to exclude"),
      created_by_any: z
        .string()
        .optional()
        .describe("Comma-separated list of user IDs"),
      created_by_not: z
        .string()
        .optional()
        .describe("Comma-separated list of user IDs to exclude"),
      assigned_by_any: z
        .string()
        .optional()
        .describe("Comma-separated list of user IDs"),
      assigned_by_not: z
        .string()
        .optional()
        .describe("Comma-separated list of user IDs to exclude"),
      liked_by_not: z
        .string()
        .optional()
        .describe("Comma-separated list of user IDs to exclude"),
      commented_on_by_not: z
        .string()
        .optional()
        .describe("Comma-separated list of user IDs to exclude"),
      due_on: z.string().optional().describe("ISO 8601 date string or null"),
      due_on_before: z.string().optional().describe("ISO 8601 date string"),
      due_on_after: z.string().optional().describe("ISO 8601 date string"),
      due_at_before: z.string().optional().describe("ISO 8601 datetime string"),
      due_at_after: z.string().optional().describe("ISO 8601 datetime string"),
      start_on: z.string().optional().describe("ISO 8601 date string or null"),
      start_on_before: z.string().optional().describe("ISO 8601 date string"),
      start_on_after: z.string().optional().describe("ISO 8601 date string"),
      created_on: z
        .string()
        .optional()
        .describe("ISO 8601 date string or null"),
      created_on_before: z.string().optional().describe("ISO 8601 date string"),
      created_on_after: z.string().optional().describe("ISO 8601 date string"),
      created_at_before: z
        .string()
        .optional()
        .describe("ISO 8601 datetime string"),
      created_at_after: z
        .string()
        .optional()
        .describe("ISO 8601 datetime string"),
      completed_on: z
        .string()
        .optional()
        .describe("ISO 8601 date string or null"),
      completed_on_before: z
        .string()
        .optional()
        .describe("ISO 8601 date string"),
      completed_on_after: z
        .string()
        .optional()
        .describe("ISO 8601 date string"),
      completed_at_before: z
        .string()
        .optional()
        .describe("ISO 8601 datetime string"),
      completed_at_after: z
        .string()
        .optional()
        .describe("ISO 8601 datetime string"),
      modified_on: z
        .string()
        .optional()
        .describe("ISO 8601 date string or null"),
      modified_on_before: z
        .string()
        .optional()
        .describe("ISO 8601 date string"),
      modified_on_after: z.string().optional().describe("ISO 8601 date string"),
      modified_at_before: z
        .string()
        .optional()
        .describe("ISO 8601 datetime string"),
      modified_at_after: z
        .string()
        .optional()
        .describe("ISO 8601 datetime string"),
      completed: z.boolean().optional().describe("Filter for completed tasks"),
      is_subtask: z.boolean().optional().describe("Filter for subtasks"),
      has_attachment: z
        .boolean()
        .optional()
        .describe("Filter for tasks with attachments"),
      is_blocked: z
        .boolean()
        .optional()
        .describe("Filter for tasks with incomplete dependencies"),
      is_blocking: z
        .boolean()
        .optional()
        .describe("Filter for incomplete tasks with dependents"),
      sort_by: z
        .string()
        .optional()
        .describe(
          "Sort by: due_date, created_at, completed_at, likes, modified_at",
        ),
      sort_ascending: z
        .boolean()
        .optional()
        .describe("Sort in ascending order"),
      opt_fields: z
        .string()
        .optional()
        .describe("Comma-separated list of optional fields to include"),
      custom_fields: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          `Object containing custom field filters. Keys should be in the format "{gid}.{operation}" where operation can be:
- {gid}.is_set: Boolean - For all custom field types, check if value is set
- {gid}.value: String|Number|String(enum_option_gid) - Direct value match for Text, Number or Enum fields
- {gid}.starts_with: String - For Text fields only, check if value starts with string
- {gid}.ends_with: String - For Text fields only, check if value ends with string
- {gid}.contains: String - For Text fields only, check if value contains string
- {gid}.less_than: Number - For Number fields only, check if value is less than number
- {gid}.greater_than: Number - For Number fields only, check if value is greater than number

Example: { "12345.value": "high", "67890.contains": "urgent" }`,
        ),
    },
    handler: async (client, { workspace, ...searchOpts }) =>
      jsonResponse(
        await client.searchTasks(resolveWorkspace(workspace), searchOpts),
      ),
  },
  {
    readOnly: true,
    name: "asana_get_task",
    description:
      "Get full details for a single task by GID. Default response is minimal (gid + name only) — always use opt_fields. Returns rich data including custom fields, memberships (project+section), HTML notes, parent, subtask count, tags, and followers.",
    inputSchema: {
      task_id: z
        .string()
        .describe(
          "The GID of the task (numeric string, e.g. `'19234567890123'`). Get it from asana_search_tasks or asana_get_tasks_for_project.",
        ),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated fields to include. Recommended: `gid,name,completed,due_on,assignee.name,notes,memberships.project.name,memberships.section.name,custom_fields,parent.name,tags.name,followers.name,resource_subtype,created_at,modified_at`.",
        ),
    },
    handler: async (client, { task_id, ...opts }) =>
      jsonResponse(await client.getTask(task_id, opts)),
  },
  {
    readOnly: false,
    name: "asana_create_task",
    description:
      "Create a new task. Use `memberships` to place it directly in a specific project section (preferred over `project_id` alone). Returns the created task object.",
    inputSchema: {
      project_id: z
        .string()
        .describe(
          "The GID of the project to add the task to (numeric string). Alternative to using `memberships` — use `memberships` when you also want to specify a section.",
        ),
      name: z.string().describe("Name of the task"),
      notes: z.string().optional().describe("Description of the task"),
      html_notes: z
        .string()
        .optional()
        .describe(
          `HTML-like formatted description of the task. Does not support ALL HTML tags. Only a subset. The only allowed TAG in the HTML are: <body> <h1> <h2> <ol> <ul> <li> <strong> <em> <u> <s> <code> <pre> <blockquote> <a data-asana-type="" data-asana-gid=""> <hr> <img> <table> <tr> <td>. No other tags are allowed. Use the \n to create a newline. Do not use \n after <body>. Example: <body><h1>Motivation</h1>
A customer called in to complain
<h1>Goal</h1>
Fix the problem</body>`,
        ),
      due_on: z.string().optional().describe("Due date in YYYY-MM-DD format"),
      assignee: z
        .string()
        .optional()
        .describe("Assignee (can be 'me' or a user ID)"),
      followers: z
        .array(z.string())
        .optional()
        .describe("Array of user IDs to add as followers"),
      parent: z
        .string()
        .optional()
        .describe("The parent task ID to set this task under"),
      projects: z
        .array(z.string())
        .optional()
        .describe("Array of project IDs to add this task to"),
      resource_subtype: z
        .string()
        .optional()
        .describe(
          "The type of the task. Can be one of 'default_task' or 'milestone'",
        ),
      custom_fields: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Object mapping custom field GID strings to their values. For enum fields use the enum option GID as the value.",
        ),
      memberships: z
        .array(
          z.object({
            project: z.string(),
            section: z.string().optional(),
          }),
        )
        .optional()
        .describe(
          'Array of project/section memberships. Each entry specifies a project and optionally a section within that project to add the task to. Example: [{"project": "123", "section": "456"}]',
        ),
    },
    handler: async (client, args) => {
      const { project_id, ...taskData } = args;

      if (taskData.html_notes) {
        const xmlValidationErrors = validateAsanaXml(taskData.html_notes);
        if (xmlValidationErrors.length > 0) {
          return xmlPreValidationErrorResponse(xmlValidationErrors);
        }
      }

      try {
        const response = await client.createTask(project_id, taskData);
        return jsonResponse(response);
      } catch (error: any) {
        if (
          taskData.html_notes &&
          error instanceof Error &&
          [400, 500].includes((error as any).status)
        ) {
          return xmlValidButErrorResponse(error);
        }
        throw error;
      }
    },
  },
  {
    readOnly: false,
    name: "asana_update_task",
    description:
      "Update fields on an existing task. Only supply the fields you want to change. Returns the updated task object. To mark complete: set `completed: true`. To move sections: use asana_add_task_to_section instead.",
    inputSchema: {
      task_id: z
        .string()
        .describe(
          "The GID of the task to update (numeric string, e.g. `'19234567890123'`).",
        ),
      name: z.string().optional().describe("New name for the task"),
      notes: z.string().optional().describe("New description for the task"),
      html_notes: z
        .string()
        .optional()
        .describe(
          `HTML-like formatted description of the task. Does not support ALL HTML tags. Only a subset. The only allowed TAG in the HTML are: <body> <h1> <h2> <ol> <ul> <li> <strong> <em> <u> <s> <code> <pre> <blockquote> <a data-asana-type="" data-asana-gid=""> <hr> <img> <table> <tr> <td>. No other tags are allowed. Use the \n to create a newline. Do not use \n after <body>. Example: <body><h1>Motivation</h1>
A customer called in to complain
<h1>Goal</h1>
Fix the problem</body>`,
        ),
      due_on: z
        .string()
        .optional()
        .describe("New due date in YYYY-MM-DD format"),
      assignee: z
        .string()
        .optional()
        .describe("New assignee (can be 'me' or a user ID)"),
      followers: z
        .array(z.string())
        .optional()
        .describe("Array of user IDs to add as followers"),
      parent: z
        .string()
        .optional()
        .describe("The parent task ID to move this task under"),
      completed: z
        .boolean()
        .optional()
        .describe("Mark task as completed or not"),
      resource_subtype: z
        .string()
        .optional()
        .describe(
          "The type of the task. Can be one of 'default_task' or 'milestone'",
        ),
      custom_fields: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Object mapping custom field GID strings to their values. For enum fields use the enum option GID as the value.",
        ),
    },
    handler: async (client, args) => {
      const { task_id, ...taskData } = args;

      if (taskData.html_notes) {
        const xmlValidationErrors = validateAsanaXml(taskData.html_notes);
        if (xmlValidationErrors.length > 0) {
          return xmlPreValidationErrorResponse(xmlValidationErrors);
        }
      }

      try {
        const response = await client.updateTask(task_id, taskData);
        return jsonResponse(response);
      } catch (error: any) {
        if (
          taskData.html_notes &&
          error instanceof Error &&
          error.message.includes("400")
        ) {
          return xmlValidButErrorResponse(error);
        }
        throw error;
      }
    },
  },
  {
    readOnly: false,
    name: "asana_create_subtask",
    description:
      "Create a subtask under an existing task. Subtasks are tasks with a parent. Returns the created subtask object. Use asana_get_subtasks to list existing subtasks.",
    inputSchema: {
      parent_task_id: z
        .string()
        .describe(
          "The GID of the parent task (numeric string, e.g. `'19234567890123'`).",
        ),
      name: z.string().describe("Name of the subtask"),
      notes: z.string().optional().describe("Description of the subtask"),
      html_notes: z
        .string()
        .optional()
        .describe(
          `HTML-like formatted description of the subtask. Does not support ALL HTML tags. Only a subset. The only allowed TAG in the HTML are: <body> <h1> <h2> <ol> <ul> <li> <strong> <em> <u> <s> <code> <pre> <blockquote> <a data-asana-type="" data-asana-gid=""> <hr> <img> <table> <tr> <td>. No other tags are allowed. Use the \n to create a newline. Do not use \n after <body>. Example: <body><h1>Motivation</h1>
A customer called in to complain
<h1>Goal</h1>
Fix the problem</body>`,
        ),
      due_on: z.string().optional().describe("Due date in YYYY-MM-DD format"),
      assignee: z
        .string()
        .optional()
        .describe("Assignee (can be 'me' or a user ID)"),
      opt_fields: z
        .string()
        .optional()
        .describe("Comma-separated list of optional fields to include"),
    },
    handler: async (client, args) => {
      const { parent_task_id, opt_fields, ...taskData } = args;

      if (taskData.html_notes) {
        const xmlValidationErrors = validateAsanaXml(taskData.html_notes);
        if (xmlValidationErrors.length > 0) {
          return xmlPreValidationErrorResponse(xmlValidationErrors);
        }
      }

      try {
        const response = await client.createSubtask(parent_task_id, taskData, {
          opt_fields,
        });
        return jsonResponse(response);
      } catch (error: any) {
        if (
          taskData.html_notes &&
          error instanceof Error &&
          error.message.includes("400")
        ) {
          return xmlValidButErrorResponse(error);
        }
        throw error;
      }
    },
  },
  {
    readOnly: true,
    name: "asana_get_multiple_tasks_by_gid",
    description:
      "Fetch up to 25 tasks by GID in a single call. More efficient than calling asana_get_task repeatedly. Use when you have a known list of task GIDs (e.g. from a search result). Returns the same fields as asana_get_task.",
    inputSchema: {
      task_ids: z
        .union([z.array(z.string()).max(25), z.string()])
        .describe(
          "Array or comma-separated string of task GIDs (max 25). Each GID is a numeric string like `'19234567890123'`.",
        ),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated fields to include. Recommended: `gid,name,completed,due_on,assignee.name,notes,memberships.project.name,memberships.section.name`.",
        ),
    },
    handler: async (client, args) => {
      const { task_ids, ...opts } = args;
      const taskIdList = Array.isArray(task_ids)
        ? task_ids
        : task_ids
            .split(",")
            .map((id: string) => id.trim())
            .filter((id: string) => id.length > 0);
      const response = await client.getMultipleTasksByGid(taskIdList, opts);
      return jsonResponse(response);
    },
  },
  {
    readOnly: false,
    name: "asana_add_project_to_task",
    description:
      "Add an existing task to a project (tasks can belong to multiple projects). Added to the end of the project by default. Optionally specify a section or relative position. Use at most one of: section, insert_after, insert_before.",
    inputSchema: {
      task_id: z
        .string()
        .describe(
          "The GID of the task to add (numeric string, e.g. `'19234567890123'`).",
        ),
      project_id: z
        .string()
        .describe(
          "The GID of the project to add the task to (numeric string).",
        ),
      section: z
        .string()
        .optional()
        .describe(
          "Optional: GID of the section within the project to add the task to.",
        ),
      insert_after: z
        .string()
        .optional()
        .describe(
          "Optional: GID of a task to insert this task after. Mutually exclusive with insert_before and section.",
        ),
      insert_before: z
        .string()
        .optional()
        .describe(
          "Optional: GID of a task to insert this task before. Mutually exclusive with insert_after and section.",
        ),
    },
    handler: async (
      client,
      { task_id, project_id, section, insert_after, insert_before },
    ) => {
      const data: any = {};
      if (section) data.section = section;
      if (insert_after) data.insert_after = insert_after;
      if (insert_before) data.insert_before = insert_before;
      await client.addProjectToTask(task_id, project_id, data);
      const message =
        `Successfully added task ${task_id} to project ${project_id}` +
        (section ? ` in section ${section}` : "");
      return successResponse(message);
    },
  },
  {
    readOnly: false,
    name: "asana_remove_project_from_task",
    description:
      "Remove a task from a project. The task still exists and remains in any other projects it belongs to. Only removes the association.",
    inputSchema: {
      task_id: z
        .string()
        .describe(
          "The GID of the task (numeric string, e.g. `'19234567890123'`).",
        ),
      project_id: z
        .string()
        .describe(
          "The GID of the project to remove the task from (numeric string).",
        ),
    },
    handler: async (client, { task_id, project_id }) => {
      await client.removeProjectFromTask(task_id, project_id);
      return successResponse(
        `Successfully removed task ${task_id} from project ${project_id}`,
      );
    },
  },
  {
    readOnly: false,
    name: "asana_delete_task",
    description:
      "Permanently delete a task including all its subtasks. This cannot be undone. Use asana_update_task with `completed: true` instead if you just want to mark it done.",
    inputSchema: {
      task_id: z
        .string()
        .describe(
          "The GID of the task to delete (numeric string, e.g. `'19234567890123'`).",
        ),
    },
    handler: async (client, { task_id }) => {
      await client.deleteTask(task_id);
      return successResponse(`Successfully deleted task ${task_id}`);
    },
  },
  {
    readOnly: true,
    name: "asana_get_subtasks",
    description:
      "List all direct subtasks of a task. Returns only one level deep — call recursively for nested subtasks. Returns minimal fields by default, use opt_fields for more.",
    inputSchema: {
      task_gid: z
        .string()
        .describe(
          "The GID of the parent task (numeric string, e.g. `'19234567890123'`).",
        ),
      limit: z.number().optional().describe("Results per page (1-100)."),
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
          "Comma-separated fields to include. Useful: `gid,name,completed,due_on,assignee.name`. Default fields: gid, name.",
        ),
    },
    handler: async (client, { task_gid, ...opts }) =>
      jsonResponse(await client.getSubtasksForTask(task_gid, opts)),
  },
  {
    readOnly: true,
    name: "asana_get_tasks_for_project",
    description:
      "List all tasks in a project (direct members only, not subtasks). Returns tasks across all sections. For tasks in a specific section use asana_get_tasks_for_section. Returns minimal fields by default — use opt_fields.",
    inputSchema: {
      project_gid: z
        .string()
        .describe(
          "The GID of the project (numeric string, e.g. `'19234567890123'`). Get it from asana_search_projects.",
        ),
      completed_since: z
        .string()
        .optional()
        .describe(
          "Only return tasks completed on or after this time. ISO 8601 datetime string or the literal string `'now'` to get only incomplete tasks.",
        ),
      limit: z.number().optional().describe("Results per page (1-100)."),
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
          "Comma-separated fields to include. Recommended: `gid,name,completed,due_on,assignee.name,notes,memberships.section.name,resource_subtype`. Default fields: gid, name.",
        ),
    },
    handler: async (client, { project_gid, ...opts }) =>
      jsonResponse(await client.getTasksForProject(project_gid, opts)),
  },
  {
    readOnly: true,
    name: "asana_get_tasks_for_section",
    description:
      "List all tasks in a specific project section. Use asana_get_project_sections to get section GIDs. Returns minimal fields by default — use opt_fields.",
    inputSchema: {
      section_gid: z
        .string()
        .describe(
          "The GID of the section (numeric string, e.g. `'19234567890123'`). Get it from asana_get_project_sections.",
        ),
      limit: z.number().optional().describe("Results per page (1-100)."),
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
          "Comma-separated fields to include. Recommended: `gid,name,completed,due_on,assignee.name`. Default fields: gid, name.",
        ),
    },
    handler: async (client, { section_gid, ...opts }) =>
      jsonResponse(await client.getTasksForSection(section_gid, opts)),
  },
];
