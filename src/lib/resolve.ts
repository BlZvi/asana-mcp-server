/**
 * Entity resolution: turn whatever the user typed into an Asana GID.
 *
 * Users should never have to hunt down a raw GID. This module accepts a bare
 * GID, any flavour of Asana permalink, the `"Name (gid)"` string emitted by the
 * autocomplete helpers in `complete.ts`, or a plain human name resolved via
 * typeahead.
 *
 * Historically several prompts did `url.split("/").pop()`, which silently
 * returns `"f"` for a focus-mode link and `"true"` for
 * `...?focus=true`. Everything here strips query strings and fragments before
 * parsing, and understands both the legacy `/0/<project>/<task>` layout and the
 * newer `/1/<ws>/project/<project>/task/<task>` layout.
 *
 * No function in this module throws on a failed lookup — resolution failure is
 * returned as data so callers can render a helpful disambiguation prompt.
 */

import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import { resolveWorkspaceOptional } from "../config.js";

/** Asana GIDs are long numeric strings; 6 digits is a safe lower bound. */
const GID_RE = /^\d{6,}$/;

/** Trailing `"Some Name (1234567890)"` produced by the autocomplete helpers. */
const TRAILING_PAREN_GID_RE = /\((\d{6,})\)\s*$/;

/**
 * Terminal path segments that mark a *project* view rather than a task.
 * `f` is deliberately excluded — it is the task focus-mode suffix.
 */
const PROJECT_VIEW_SEGMENTS = new Set([
  "list",
  "board",
  "calendar",
  "timeline",
  "gantt",
  "files",
  "dashboard",
  "conversations",
  "overview",
  "messages",
  "workflow",
]);

/** True when the string is entirely a plausible GID. */
function isGid(value: string | undefined): value is string {
  return typeof value === "string" && GID_RE.test(value);
}

/** Drop `?query` and `#fragment` so they can never be mistaken for an id. */
function stripQueryAndFragment(input: string): string {
  return input.split("#")[0].split("?")[0];
}

/** Split a path-ish string into non-empty segments. */
function pathSegments(input: string): string[] {
  return stripQueryAndFragment(input)
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

/** Find the GID immediately following a keyword segment such as `task`/`project`. */
function gidAfterKeyword(segments: string[], keyword: string): string | null {
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i].toLowerCase() === keyword && isGid(segments[i + 1])) {
      return segments[i + 1];
    }
  }
  return null;
}

/** Shared prefix handling: bare GID and the `"Name (gid)"` completer format. */
function directGid(input: unknown): string | null {
  if (typeof input !== "string") return null;

  const trimmed = input.trim();
  if (trimmed === "") return null;

  if (GID_RE.test(trimmed)) return trimmed;

  const paren = trimmed.match(TRAILING_PAREN_GID_RE);
  return paren ? paren[1] : null;
}

/**
 * Extract a **task** GID from a bare GID, an Asana URL, or a `"Name (gid)"`
 * autocomplete value.
 *
 * Recognised forms:
 * - `1234567890123`
 * - `Fix login bug (1234567890123)`
 * - `https://app.asana.com/0/<project>/<task>` (with optional `?query`, `#frag`, or `/f`)
 * - `https://app.asana.com/1/<ws>/project/<project>/task/<task>`
 * - any URL containing a `/task/<gid>` segment
 *
 * @returns the task GID, or `null` when the input denotes a project or carries
 *          no numeric id at all.
 */
export function extractGid(input: string): string | null {
  const direct = directGid(input);
  if (direct) return direct;
  if (typeof input !== "string") return null;

  const segments = pathSegments(input);
  if (segments.length === 0) return null;

  // Explicit `/task/<gid>` always wins — it is unambiguous.
  const explicit = gidAfterKeyword(segments, "task");
  if (explicit) return explicit;

  // A `/project/<gid>` URL with no task segment denotes a project, not a task.
  if (segments.some((segment) => segment.toLowerCase() === "project")) {
    return null;
  }

  // `/0/<project>/list` and friends are project views, not tasks.
  const last = segments[segments.length - 1].toLowerCase();
  if (PROJECT_VIEW_SEGMENTS.has(last)) return null;

  // Legacy `/0/<project>/<task>[/f]` — the task is the last numeric segment.
  for (let i = segments.length - 1; i >= 0; i--) {
    if (isGid(segments[i])) {
      // A lone id directly after `/0/` is the project, not a task.
      const isProjectSlot =
        i > 0 && segments[i - 1] === "0" && !isGid(segments[i + 1] ?? "");
      if (isProjectSlot) return null;
      return segments[i];
    }
  }

  return null;
}

/**
 * Extract a **project** GID from a bare GID, an Asana URL, or a `"Name (gid)"`
 * autocomplete value.
 *
 * Recognised forms:
 * - `1200000000`
 * - `Backend API (1200000000)`
 * - `https://app.asana.com/0/<project>/list`
 * - `https://app.asana.com/0/<project>/<task>` (returns the *project*)
 * - `https://app.asana.com/1/<ws>/project/<project>/task/<task>`
 */
export function extractProjectGid(input: string): string | null {
  const direct = directGid(input);
  if (direct) return direct;
  if (typeof input !== "string") return null;

  const segments = pathSegments(input);
  if (segments.length === 0) return null;

  // Explicit `/project/<gid>`.
  const explicit = gidAfterKeyword(segments, "project");
  if (explicit) return explicit;

  // Legacy `/0/<project>/...` — the id directly after the `0` pseudo-segment.
  const legacy = gidAfterKeyword(segments, "0");
  if (legacy) return legacy;

  // Fall back to the first numeric segment: in every project permalink the
  // project id precedes any task id.
  for (const segment of segments) {
    if (isGid(segment)) return segment;
  }

  return null;
}

export type ResolveResult =
  | {
      ok: true;
      gid: string;
      name?: string;
      via: "gid" | "url" | "exact" | "typeahead";
    }
  | {
      ok: false;
      reason: "not_found" | "ambiguous";
      candidates: { gid: string; name: string }[];
      query: string;
    };

/** A bare GID is `via: "gid"`; anything we had to parse out of a URL is `via: "url"`. */
function viaForInput(input: string): "gid" | "url" {
  return GID_RE.test(input.trim()) ? "gid" : "url";
}

function notFound(query: string): ResolveResult {
  return { ok: false, reason: "not_found", candidates: [], query };
}

/** Normalise a typeahead payload into `{gid, name}` pairs, discarding junk rows. */
function toCandidates(results: any): { gid: string; name: string }[] {
  if (!Array.isArray(results)) return [];

  const candidates: { gid: string; name: string }[] = [];
  for (const result of results) {
    const gid = result?.gid;
    if (typeof gid !== "string" || gid === "") continue;
    candidates.push({
      gid,
      name: typeof result?.name === "string" ? result.name : gid,
    });
  }
  return candidates;
}

/**
 * Shared typeahead resolution.
 *
 * One hit resolves directly. Several hits resolve only when exactly one is a
 * case-insensitive exact name match; otherwise the caller is handed the full
 * candidate list to disambiguate.
 */
async function resolveByTypeahead(
  client: AsanaClientWrapper,
  input: string,
  resourceType: string,
  workspaceGid?: string,
): Promise<ResolveResult> {
  const workspace = resolveWorkspaceOptional(workspaceGid);
  if (!workspace) return notFound(input);

  let candidates: { gid: string; name: string }[];
  try {
    const results = await client.typeaheadForWorkspace(
      workspace,
      resourceType,
      { query: input, count: 10, opt_fields: "gid,name" },
    );
    candidates = toCandidates(results);
  } catch {
    // A failed lookup is indistinguishable from "nothing matched" to the user.
    return notFound(input);
  }

  if (candidates.length === 0) return notFound(input);

  if (candidates.length === 1) {
    return {
      ok: true,
      gid: candidates[0].gid,
      name: candidates[0].name,
      via: "typeahead",
    };
  }

  const needle = input.trim().toLowerCase();
  const exact = candidates.filter(
    (candidate) => candidate.name.trim().toLowerCase() === needle,
  );
  if (exact.length === 1) {
    return { ok: true, gid: exact[0].gid, name: exact[0].name, via: "exact" };
  }

  return { ok: false, reason: "ambiguous", candidates, query: input };
}

/** Resolve a task from a GID, URL, autocomplete value, or name. Never throws. */
export async function resolveTaskGid(
  client: AsanaClientWrapper,
  input: string,
  workspaceGid?: string,
): Promise<ResolveResult> {
  if (typeof input !== "string" || input.trim() === "") return notFound("");

  const gid = extractGid(input);
  if (gid) return { ok: true, gid, via: viaForInput(input) };

  return resolveByTypeahead(client, input, "task", workspaceGid);
}

/** Resolve a project from a GID, URL, autocomplete value, or name. Never throws. */
export async function resolveProjectGid(
  client: AsanaClientWrapper,
  input: string,
  workspaceGid?: string,
): Promise<ResolveResult> {
  if (typeof input !== "string" || input.trim() === "") return notFound("");

  const gid = extractProjectGid(input);
  if (gid) return { ok: true, gid, via: viaForInput(input) };

  return resolveByTypeahead(client, input, "project", workspaceGid);
}

/**
 * Resolve a user from a GID, `"me"`, an email address, an autocomplete value,
 * or a display name. Never throws.
 */
export async function resolveUserGid(
  client: AsanaClientWrapper,
  input: string,
  workspaceGid?: string,
): Promise<ResolveResult> {
  if (typeof input !== "string" || input.trim() === "") return notFound("");

  const trimmed = input.trim();

  const direct = directGid(trimmed);
  if (direct) return { ok: true, gid: direct, via: viaForInput(trimmed) };

  // The Asana users endpoint accepts "me" and email addresses natively, which
  // is both cheaper and more accurate than typeahead.
  const isMe = trimmed.toLowerCase() === "me";
  if (isMe || trimmed.includes("@")) {
    try {
      const user: any = await client.getUser(trimmed, {
        opt_fields: "gid,name",
      });
      if (typeof user?.gid === "string" && user.gid !== "") {
        return { ok: true, gid: user.gid, name: user.name, via: "exact" };
      }
    } catch {
      // Fall through to typeahead — unless "me" failed, which typeahead
      // cannot help with either.
    }
    if (isMe) return notFound(trimmed);
  }

  return resolveByTypeahead(client, trimmed, "user", workspaceGid);
}

/** `project` -> `projects`, `entity` -> `entities`. Good enough for our nouns. */
function pluralize(kind: string): string {
  if (kind.endsWith("s")) return kind;
  if (kind.endsWith("y")) return `${kind.slice(0, -1)}ies`;
  return `${kind}s`;
}

/**
 * Render a resolution failure as a message the user can act on.
 *
 * Ambiguous results list every candidate with its GID so the user can re-run
 * with an unambiguous value; not-found results say so plainly rather than
 * pretending an empty result set is a server error.
 */
export function formatResolveFailure(
  r: Extract<ResolveResult, { ok: false }>,
  kind: string,
): string {
  const query = r.query;

  if (r.reason === "ambiguous" && r.candidates.length > 0) {
    const lines = r.candidates.map(
      (candidate) => `  - ${candidate.name} (${candidate.gid})`,
    );
    return `Multiple ${pluralize(kind)} match "${query}". Re-run with one of these GIDs:\n${lines.join("\n")}`;
  }

  return `No ${kind} found matching "${query}". Try a different name, or pass the GID directly.`;
}
