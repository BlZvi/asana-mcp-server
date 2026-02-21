import { z } from "zod";
import { jsonResponse } from "./helpers.js";
import type { ToolEntry } from "./types.js";

export const taskRelationshipTools: ToolEntry[] = [
  {
    readOnly: false,
    name: "asana_add_task_dependencies",
    description:
      "Mark one or more tasks as dependencies of a given task (i.e. the given task cannot start until the dependency tasks are complete). Returns an empty object `{}` on success. Use asana_get_task with opt_fields=`dependencies` to verify.",
    inputSchema: {
      task_id: z
        .string()
        .describe(
          "The GID of the task that will depend on the listed tasks (numeric string, e.g. `'19234567890123'`).",
        ),
      dependencies: z
        .array(z.string())
        .describe(
          "Array of task GIDs that this task depends on (each a numeric string). These tasks must be completed before this task can start.",
        ),
    },
    handler: async (client, { task_id, dependencies }) =>
      jsonResponse(await client.addTaskDependencies(task_id, dependencies)),
  },
  {
    readOnly: false,
    name: "asana_add_task_dependents",
    description:
      "Mark one or more tasks as dependents of a given task (i.e. those tasks cannot start until this task is complete). Returns an empty object `{}` on success. This is the inverse of asana_add_task_dependencies.",
    inputSchema: {
      task_id: z
        .string()
        .describe(
          "The GID of the task that the listed tasks depend on (numeric string, e.g. `'19234567890123'`). This task must complete before the dependents can start.",
        ),
      dependents: z
        .array(z.string())
        .describe(
          "Array of task GIDs that depend on this task (each a numeric string). These tasks are blocked until this task is complete.",
        ),
    },
    handler: async (client, { task_id, dependents }) =>
      jsonResponse(await client.addTaskDependents(task_id, dependents)),
  },
  {
    readOnly: false,
    name: "asana_set_parent_for_task",
    description:
      "Convert a task into a subtask by assigning it a parent task. Optionally control the subtask's position among its siblings. Returns the updated task object including the new parent. To remove a parent (promote a subtask to top-level), set parent to `null`.",
    inputSchema: {
      task_id: z
        .string()
        .describe(
          "The GID of the task to make a subtask (numeric string, e.g. `'19234567890123'`).",
        ),
      parent: z
        .string()
        .describe(
          "The GID of the new parent task, or `null` to remove the parent and make this a top-level task.",
        ),
      insert_after: z
        .string()
        .optional()
        .describe(
          "GID of a sibling subtask to insert this task after. Cannot be used with insert_before. Omit to insert at the end.",
        ),
      insert_before: z
        .string()
        .optional()
        .describe(
          "GID of a sibling subtask to insert this task before. Cannot be used with insert_after. Omit to insert at the beginning.",
        ),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated extra fields to include. Useful values: `gid,name,parent.gid,parent.name,resource_subtype`.",
        ),
    },
    handler: async (
      client,
      { task_id, parent, insert_after, insert_before, opt_fields },
    ) => {
      const data: any = { parent };
      if (insert_after) data.insert_after = insert_after;
      if (insert_before) data.insert_before = insert_before;
      const opts = opt_fields ? { opt_fields } : {};
      const response = await client.setParentForTask(data, task_id, opts);
      return jsonResponse(response);
    },
  },
];
