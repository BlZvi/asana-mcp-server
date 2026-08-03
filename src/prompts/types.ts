import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import { todayISO as tzTodayISO } from "../lib/dates.js";

/**
 * Today's date as YYYY-MM-DD in the configured timezone.
 *
 * Delegates to the timezone-aware implementation. Using UTC here caused tasks
 * to be flagged overdue a day early for users west of UTC.
 */
export const todayISO = (): string => tzTodayISO();

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
  /** Human-friendly label shown in slash-command menus. */
  title?: string;
};
