import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";

export type PromptHandlerFn = (
  client: AsanaClientWrapper,
  args: Record<string, string | undefined>,
) => Promise<GetPromptResult>;

export type PromptEntry = {
  name: string;
  description: string;
  readOnly: boolean;
  argsSchema: ZodRawShape;
  handler: PromptHandlerFn;
};
