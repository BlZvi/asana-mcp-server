/**
 * Autocomplete callbacks for MCP `completable()` prompt arguments.
 *
 * These drive a live dropdown in the client so users pick a real entity by
 * name instead of hand-copying a GID out of a browser URL bar.
 *
 * Two hard rules govern everything here:
 *
 * 1. **Never throw.** A rejected completion promise breaks the client's
 *    argument UI entirely — far worse than an empty dropdown. Every path
 *    returns `[]` on failure.
 * 2. **Never hammer the API.** Completers fire on every keystroke, so results
 *    are cached for 60s and concurrent identical lookups are de-duplicated by
 *    {@link TTLCache.getOrSet}.
 *
 * Values are formatted as `"Name (gid)"` — readable by a human, and parseable
 * by `extractGid` / `extractProjectGid` in `resolve.ts`, which recognise the
 * trailing-parenthesis form.
 */

import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import { resolveWorkspaceOptional } from "../config.js";
import { cacheKey, TTLCache } from "./cache.js";

export type Completer = (
  value: string,
  context?: { arguments?: Record<string, string> },
) => Promise<string[]>;

/** Asana entity kinds the typeahead endpoint supports. */
export type CompletableResourceType =
  | "task"
  | "project"
  | "user"
  | "tag"
  | "team"
  | "portfolio"
  | "goal";

/** Keystroke-scale TTL: long enough to absorb typing, short enough to stay fresh. */
const COMPLETION_TTL_MS = 60 * 1000;

/** Default dropdown length. Asana's typeahead caps out around 100. */
const DEFAULT_COUNT = 20;

/** Prompt argument consulted for the workspace when none is configured. */
const DEFAULT_WORKSPACE_ARG = "workspace_gid";

/**
 * Shared across all completers so a project lookup in one prompt warms the
 * cache for the same lookup in another. Bounded to keep memory flat under a
 * long-lived server process.
 */
const completionCache = new TTLCache({ maxEntries: 200 });

/**
 * Build an autocomplete callback backed by Asana's typeahead endpoint.
 *
 * @param client Asana wrapper used for the lookup.
 * @param resourceType Entity kind to search for.
 * @param opts.count Maximum suggestions to return. Default 20.
 * @param opts.workspaceArg Name of the sibling prompt argument holding the
 *   workspace GID. Default `"workspace_gid"`. Falls back to the configured
 *   default workspace when that argument is absent.
 * @returns a completer that resolves to `"Name (gid)"` strings, or `[]`.
 */
export function makeResourceCompleter(
  client: AsanaClientWrapper,
  resourceType: CompletableResourceType,
  opts?: { count?: number; workspaceArg?: string },
): Completer {
  const count = opts?.count ?? DEFAULT_COUNT;
  const workspaceArg = opts?.workspaceArg ?? DEFAULT_WORKSPACE_ARG;

  return async (value, context) => {
    try {
      const fromArgs = context?.arguments?.[workspaceArg];
      const workspace = resolveWorkspaceOptional(
        typeof fromArgs === "string" && fromArgs.trim() !== ""
          ? fromArgs.trim()
          : undefined,
      );

      // No workspace, no lookup. An empty dropdown is the correct UX here.
      if (!workspace) return [];

      const query = typeof value === "string" ? value : "";
      const key = cacheKey("complete", {
        resourceType,
        workspace,
        query,
        count,
      });

      return await completionCache.getOrSet(
        key,
        COMPLETION_TTL_MS,
        async () => {
          const results = await client.typeaheadForWorkspace(
            workspace,
            resourceType,
            { query, count, opt_fields: "gid,name" },
          );

          if (!Array.isArray(results)) return [];

          const formatted: string[] = [];
          for (const result of results) {
            const gid = (result as any)?.gid;
            if (typeof gid !== "string" || gid === "") continue;

            const name = (result as any)?.name;
            formatted.push(
              `${typeof name === "string" && name !== "" ? name : gid} (${gid})`,
            );
          }
          return formatted;
        },
      );
    } catch {
      return [];
    }
  };
}

/**
 * Build an autocomplete callback over a fixed value list.
 *
 * Prefix matches are ranked above substring matches so typing `"co"` surfaces
 * `"completed"` before `"incomplete"`. An empty query returns everything.
 */
export function makeStaticCompleter(values: string[]): Completer {
  const source = Array.isArray(values)
    ? values.filter((value) => typeof value === "string")
    : [];

  return async (value) => {
    const needle = (typeof value === "string" ? value : "")
      .trim()
      .toLowerCase();
    if (needle === "") return [...source];

    const prefix: string[] = [];
    const substring: string[] = [];

    for (const candidate of source) {
      const haystack = candidate.toLowerCase();
      if (haystack.startsWith(needle)) prefix.push(candidate);
      else if (haystack.includes(needle)) substring.push(candidate);
    }

    return [...prefix, ...substring];
  };
}
