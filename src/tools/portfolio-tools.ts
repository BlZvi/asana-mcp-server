import { z } from "zod";
import { resolveWorkspace } from "../config.js";
import { jsonResponse, successResponse } from "./helpers.js";
import type { ToolEntry } from "./types.js";

export const portfolioTools: ToolEntry[] = [
  {
    readOnly: true,
    name: "asana_get_portfolio",
    description:
      "Get full details for a portfolio by GID. Returns name, color, public status, owner, members, and workspace. Use asana_get_portfolios to find portfolio GIDs.",
    inputSchema: {
      portfolio_gid: z
        .string()
        .describe(
          "The GID of the portfolio (numeric string, e.g. `'1234567890123'`). Get portfolio GIDs from asana_get_portfolios.",
        ),
      opt_fields: z
        .string()
        .describe(
          "Comma-separated extra fields to include. Useful values: `gid,name,color,public,created_at,owner.name,members.name,workspace.name`. Default fields: gid, resource_type.",
        )
        .optional(),
    },
    handler: async (client, { portfolio_gid, ...opts }) =>
      jsonResponse(await client.getPortfolio(portfolio_gid, opts)),
  },
  {
    readOnly: true,
    name: "asana_get_portfolios",
    description:
      "List portfolios in a workspace. IMPORTANT: The `owner` parameter is required by the Asana API — omitting it returns a Bad Request error. Use `owner: 'me'` to list your own portfolios. Returns an array of portfolio objects.",
    inputSchema: {
      workspace: z
        .string()
        .optional()
        .describe(
          "The GID of the workspace (numeric string, e.g. `'1234567890123'`). Get it from asana_list_workspaces. Can be omitted if ASANA_DEFAULT_WORKSPACE_GID is set.",
        ),
      owner: z
        .string()
        .describe(
          "Required. The user whose portfolios to list. Use `'me'` for the current user, or a user GID. The Asana API returns an error if this is omitted.",
        )
        .optional(),
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
          "Comma-separated extra fields to include. Useful values: `gid,name,color,public,owner.name`. Default fields: gid, resource_type.",
        )
        .optional(),
    },
    handler: async (client, { workspace, ...opts }) =>
      jsonResponse(
        await client.getPortfolios(resolveWorkspace(workspace), opts),
      ),
  },
  {
    readOnly: false,
    name: "asana_create_portfolio",
    description:
      "Create a new portfolio in a workspace. Portfolios group related projects for high-level tracking. Returns the created portfolio object with gid and name.",
    inputSchema: {
      workspace: z
        .string()
        .optional()
        .describe(
          "The GID of the workspace (numeric string, e.g. `'1234567890123'`). Get it from asana_list_workspaces. Can be omitted if ASANA_DEFAULT_WORKSPACE_GID is set.",
        ),
      name: z.string().describe("Name of the portfolio."),
      color: z
        .string()
        .describe(
          "Color of the portfolio. One of: dark-pink, dark-green, dark-blue, dark-red, dark-teal, dark-brown, dark-orange, dark-purple, dark-warm-gray, light-pink, light-green, light-blue, light-red, light-teal, light-brown, light-orange, light-purple, light-warm-gray.",
        )
        .optional(),
      public: z
        .boolean()
        .describe(
          "Whether the portfolio is visible to everyone in the workspace. Defaults to false (private).",
        )
        .optional(),
      opt_fields: z
        .string()
        .describe(
          "Comma-separated fields to include in the response. Useful values: `gid,name,color,public,created_at`.",
        )
        .optional(),
    },
    handler: async (client, { workspace, opt_fields, ...data }) =>
      jsonResponse(
        await client.createPortfolio(
          { ...data, workspace: resolveWorkspace(workspace) },
          { opt_fields },
        ),
      ),
  },
  {
    readOnly: false,
    name: "asana_update_portfolio",
    description:
      "Update the name, color, or public visibility of a portfolio. Only supply the fields to change. Returns the updated portfolio object.",
    inputSchema: {
      portfolio_gid: z
        .string()
        .describe(
          "The GID of the portfolio to update (numeric string, e.g. `'1234567890123'`).",
        ),
      name: z.string().describe("New name for the portfolio.").optional(),
      color: z
        .string()
        .describe(
          "New color. One of: dark-pink, dark-green, dark-blue, dark-red, dark-teal, dark-brown, dark-orange, dark-purple, dark-warm-gray, light-pink, light-green, light-blue, light-red, light-teal, light-brown, light-orange, light-purple, light-warm-gray.",
        )
        .optional(),
      public: z.boolean().describe("New public visibility setting.").optional(),
      opt_fields: z
        .string()
        .describe(
          "Comma-separated fields to include in the response. Useful values: `gid,name,color,public`.",
        )
        .optional(),
    },
    handler: async (client, { portfolio_gid, opt_fields, ...data }) =>
      jsonResponse(
        await client.updatePortfolio(portfolio_gid, data, { opt_fields }),
      ),
  },
  {
    readOnly: false,
    name: "asana_delete_portfolio",
    description:
      "Permanently delete a portfolio. This does NOT delete the projects in the portfolio. Returns a success message.",
    inputSchema: {
      portfolio_gid: z
        .string()
        .describe(
          "The GID of the portfolio to delete (numeric string, e.g. `'1234567890123'`).",
        ),
    },
    handler: async (client, { portfolio_gid }) => {
      await client.deletePortfolio(portfolio_gid);
      return successResponse(`Successfully deleted portfolio ${portfolio_gid}`);
    },
  },
  {
    readOnly: true,
    name: "asana_get_portfolio_items",
    description:
      "List all projects in a portfolio. Returns an array of project objects with gid, name, color, and archived status. Use asana_add_portfolio_item to add projects.",
    inputSchema: {
      portfolio_gid: z
        .string()
        .describe(
          "The GID of the portfolio (numeric string, e.g. `'1234567890123'`).",
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
          "Comma-separated extra fields to include. Useful values: `gid,name,color,archived,due_on,status`. Default fields: gid, resource_type.",
        )
        .optional(),
    },
    handler: async (client, { portfolio_gid, ...opts }) =>
      jsonResponse(await client.getPortfolioItems(portfolio_gid, opts)),
  },
  {
    readOnly: false,
    name: "asana_add_portfolio_item",
    description:
      "Add a project to a portfolio. Optionally control placement with insert_before or insert_after. Returns a success message.",
    inputSchema: {
      portfolio_gid: z
        .string()
        .describe(
          "The GID of the portfolio to add the project to (numeric string, e.g. `'1234567890123'`).",
        ),
      item: z
        .string()
        .describe(
          "The GID of the project to add (numeric string, e.g. `'1234567890123'`).",
        ),
      insert_before: z
        .string()
        .describe(
          "GID of an existing portfolio item to insert this project before. Cannot be used with insert_after.",
        )
        .optional(),
      insert_after: z
        .string()
        .describe(
          "GID of an existing portfolio item to insert this project after. Cannot be used with insert_before.",
        )
        .optional(),
    },
    handler: async (
      client,
      { portfolio_gid, item, insert_before, insert_after },
    ) => {
      const data: any = { item };
      if (insert_before) data.insert_before = insert_before;
      if (insert_after) data.insert_after = insert_after;
      await client.addPortfolioItem(portfolio_gid, data);
      return successResponse(
        `Successfully added project ${item} to portfolio ${portfolio_gid}`,
      );
    },
  },
  {
    readOnly: false,
    name: "asana_remove_portfolio_item",
    description:
      "Remove a project from a portfolio. This does NOT delete the project — it only removes the association. Returns a success message.",
    inputSchema: {
      portfolio_gid: z
        .string()
        .describe(
          "The GID of the portfolio to remove the project from (numeric string, e.g. `'1234567890123'`).",
        ),
      item: z
        .string()
        .describe(
          "The GID of the project to remove (numeric string, e.g. `'1234567890123'`).",
        ),
    },
    handler: async (client, { portfolio_gid, item }) => {
      await client.removePortfolioItem(portfolio_gid, { item });
      return successResponse(
        `Successfully removed project ${item} from portfolio ${portfolio_gid}`,
      );
    },
  },
];
