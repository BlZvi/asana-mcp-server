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
  /** Human-friendly label shown in client UIs. Defaults to a title-cased name. */
  title?: string;
  /**
   * Irreversibly removes data. Surfaced to clients as `destructiveHint` so they
   * can require confirmation for these specifically rather than for all writes.
   */
  destructive?: boolean;
  /** Repeating the call with identical arguments has no additional effect. */
  idempotent?: boolean;
};
