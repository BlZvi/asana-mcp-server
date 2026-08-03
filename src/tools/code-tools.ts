import { z } from "zod";
import { resolveWorkspace } from "../config.js";
import { extractGid } from "../lib/resolve.js";
import { jsonResponse } from "./helpers.js";
import type { ToolEntry } from "./types.js";

/** `#1234` or `ASANA-1234` style references used in branch/commit conventions. */
const SHORT_REF_RE = /(?:^|[^\w])(?:#|ASANA[-_])(\d{4,})/i;

export type RefMatch = {
  ref: string;
  taskGid: string;
  taskName: string | null;
  permalink_url: string | null;
  matchedVia: "gid" | "url" | "shortref" | "name";
};

export type MatchRefsResult = {
  matched: RefMatch[];
  unmatched: string[];
  notes: string[];
};

/**
 * Resolve free-form code references (branch names, commit subjects, PR titles)
 * to Asana tasks.
 *
 * Fuzzy name matching is deliberately conservative: it only accepts a typeahead
 * hit when exactly one candidate comes back. Auto-linking a commit to the wrong
 * task is worse than leaving it unmatched, because the mistake is invisible
 * downstream.
 */
export async function matchRefsToTasks(
  client: any,
  refs: string[],
  workspaceGid: string,
): Promise<MatchRefsResult> {
  const matched: RefMatch[] = [];
  const unmatched: string[] = [];
  const notes: string[] = [];
  const seen = new Map<string, { name: string | null; url: string | null }>();

  for (const ref of refs) {
    const trimmed = ref.trim();
    if (trimmed === "") continue;

    // 1. A bare GID or full Asana URL embedded anywhere in the string.
    const direct = extractGid(trimmed);
    if (direct) {
      const meta = await lookup(client, direct, seen);
      matched.push({
        ref: trimmed,
        taskGid: direct,
        taskName: meta.name,
        permalink_url: meta.url,
        matchedVia: /^\d{6,}$/.test(trimmed) ? "gid" : "url",
      });
      continue;
    }

    // 2. Short-form conventions.
    const short = SHORT_REF_RE.exec(trimmed);
    if (short) {
      const candidate = short[1];
      const meta = await lookup(client, candidate, seen);
      if (meta.name !== null) {
        matched.push({
          ref: trimmed,
          taskGid: candidate,
          taskName: meta.name,
          permalink_url: meta.url,
          matchedVia: "shortref",
        });
        continue;
      }
    }

    // 3. Fuzzy name match — single unambiguous hit only.
    const cleaned = trimmed
      .replace(
        /^(feat|fix|chore|docs|refactor|test|perf|build|ci)(\([^)]*\))?:\s*/i,
        "",
      )
      .replace(/^(feature|bugfix|hotfix|release)\//i, "")
      .replace(/[-_]+/g, " ")
      .trim();

    if (cleaned.length >= 4) {
      try {
        const { data } = await client.typeaheadForWorkspace(
          workspaceGid,
          "task",
          { query: cleaned, count: 5, opt_fields: "gid,name,permalink_url" },
        );
        if (Array.isArray(data) && data.length === 1) {
          matched.push({
            ref: trimmed,
            taskGid: data[0].gid,
            taskName: data[0].name ?? null,
            permalink_url: data[0].permalink_url ?? null,
            matchedVia: "name",
          });
          continue;
        }
        if (Array.isArray(data) && data.length > 1) {
          notes.push(
            `"${trimmed}" matched ${data.length} tasks by name — left unmatched to avoid a wrong link.`,
          );
        }
      } catch {
        // Typeahead failure is non-fatal; the ref simply stays unmatched.
      }
    }

    unmatched.push(trimmed);
  }

  return { matched, unmatched, notes };
}

async function lookup(
  client: any,
  gid: string,
  cache: Map<string, { name: string | null; url: string | null }>,
): Promise<{ name: string | null; url: string | null }> {
  const hit = cache.get(gid);
  if (hit) return hit;
  try {
    const t = await client.getTask(gid, { opt_fields: "name,permalink_url" });
    const meta = {
      name: t?.name ?? null,
      url: t?.permalink_url ?? null,
    };
    cache.set(gid, meta);
    return meta;
  } catch {
    const meta = { name: null, url: null };
    cache.set(gid, meta);
    return meta;
  }
}

export const codeTools: ToolEntry[] = [
  {
    readOnly: true,
    name: "asana_match_tasks_to_refs",
    description:
      "Resolve code references — branch names, commit subjects, PR titles — to the Asana tasks they refer to. Recognizes bare GIDs, Asana URLs, `#1234` / `ASANA-1234` conventions, and falls back to a conservative fuzzy name match that only accepts a single unambiguous hit. Use this to connect repository history to Asana work, e.g. to find which tasks have no code behind them or which commits have no tracked task.",
    inputSchema: {
      refs: z
        .string()
        .describe(
          "Newline- or comma-separated code references to resolve. Typically the output of `git log --oneline`, `git branch --list`, or a list of PR titles.",
        ),
      workspace: z
        .string()
        .optional()
        .describe(
          "Workspace GID to resolve names in. Can be omitted if ASANA_DEFAULT_WORKSPACE_GID is set.",
        ),
    },
    handler: async (client, args) => {
      const workspaceGid = resolveWorkspace(args?.workspace);
      const raw = String(args?.refs ?? "");
      const refs = raw
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 200);

      if (refs.length === 0) {
        return jsonResponse({
          matched: [],
          unmatched: [],
          notes: ["No references were provided."],
        });
      }

      const result = await matchRefsToTasks(client, refs, workspaceGid);
      return jsonResponse(result);
    },
  },
];
