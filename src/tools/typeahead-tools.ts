import { z } from "zod";
import { resolveWorkspace } from "../config.js";
import { jsonResponse } from "./helpers.js";
import type { ToolEntry } from "./types.js";

export const typeaheadTools: ToolEntry[] = [
  {
    readOnly: true,
    name: "asana_typeahead",
    description:
      "Search for Asana objects (tasks, projects, users, tags, teams, portfolios, goals) by partial name. Returns up to 100 compact results with gid and name. Use this to find the GID of a resource when you only know its name — e.g. find a task called 'Fix login bug' before updating it. Results are ordered by relevance (recency for projects, contact frequency for users). For users, include `opt_fields: 'gid,name,email'` to get email addresses.",
    inputSchema: {
      resource_type: z
        .enum([
          "task",
          "project",
          "user",
          "tag",
          "team",
          "portfolio",
          "goal",
          "custom_field",
          "project_template",
        ])
        .describe(
          "The type of resource to search. One of: `task`, `project`, `user`, `tag`, `team`, `portfolio`, `goal`, `custom_field`, `project_template`.",
        ),
      query: z
        .string()
        .optional()
        .describe(
          "Partial name to search for (case-insensitive). If omitted, returns the most relevant objects based on recent activity.",
        ),
      workspace: z
        .string()
        .optional()
        .describe(
          "The GID of the workspace to search in (numeric string, e.g. `'1234567890123'`). Can be omitted if ASANA_DEFAULT_WORKSPACE_GID is set.",
        ),
      count: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of results to return (1–100). Defaults to 20."),
      opt_fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated extra fields to include. For users: `gid,name,email`. For tasks: `gid,name,completed,due_on`. For projects: `gid,name,color`.",
        ),
    },
    handler: async (client, { workspace, resource_type, ...opts }) =>
      jsonResponse(
        await client.typeaheadForWorkspace(
          resolveWorkspace(workspace),
          resource_type,
          opts,
        ),
      ),
  },
];
