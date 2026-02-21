import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";

export type ToolHandler = (
  client: AsanaClientWrapper,
  args: any,
) => Promise<CallToolResult>;

export type ToolEntry = {
  name: string;
  description: string;
  readOnly: boolean;
  inputSchema: ZodRawShape;
  handler: ToolHandler;
};
