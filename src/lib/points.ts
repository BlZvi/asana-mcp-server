/**
 * Story-point / estimate custom-field discovery and value extraction.
 *
 * The single most important contract in this module: **a workspace with no
 * points field is a normal, supported state, not an error.** Most Asana teams
 * never configure one. Every function here degrades to `null` / zero rather
 * than throwing, so callers can render "points unavailable" instead of
 * failing an entire prompt.
 */

import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import { pointsFieldGid, pointsFieldNamePattern } from "../config.js";

export type PointsField = { gid: string; name: string; type: string };

/** Fallback shape used when a GID is configured but its metadata is unreachable. */
const FALLBACK_TYPE = "number";
const FALLBACK_NAME = "points";

/** opt_fields kept minimal — we only ever need identity + type. */
const CUSTOM_FIELD_OPT_FIELDS = "gid,name,type,resource_subtype";

/**
 * Compile the configured name pattern. A user-supplied regex that fails to
 * compile must not take the server down, so we fall back to matching nothing.
 */
function namePatternRegex(): RegExp | null {
  try {
    return new RegExp(pointsFieldNamePattern, "i");
  } catch {
    return null;
  }
}

/** Normalise anything field-shaped into a PointsField, tolerating partial data. */
function toPointsField(field: any): PointsField | null {
  const gid = field?.gid;
  if (typeof gid !== "string" || gid === "") return null;
  return {
    gid,
    name: typeof field?.name === "string" ? field.name : FALLBACK_NAME,
    type: typeof field?.type === "string" ? field.type : FALLBACK_TYPE,
  };
}

/**
 * Pick the best points-like field from a list.
 *
 * A `number` field always wins. An `enum` is accepted only when no numeric
 * candidate exists at all — some teams encode t-shirt sizes as enums, but a
 * real numeric estimate field is unambiguously the better signal.
 */
function pickBestMatch(fields: any[], pattern: RegExp): PointsField | null {
  let enumFallback: PointsField | null = null;

  for (const raw of fields) {
    const field = toPointsField(raw);
    if (!field || !pattern.test(field.name)) continue;

    if (field.type === "number") return field;
    if (field.type === "enum" && !enumFallback) enumFallback = field;
  }

  return enumFallback;
}

/** Fetch every custom field in a workspace, following pagination defensively. */
async function listWorkspaceCustomFields(
  client: AsanaClientWrapper,
  workspaceGid: string,
): Promise<any[]> {
  const collected: any[] = [];
  let offset: string | undefined;

  // Hard page cap: discovery is a convenience, never worth an unbounded crawl.
  for (let page = 0; page < 10; page++) {
    const opts: any = { limit: 100, opt_fields: CUSTOM_FIELD_OPT_FIELDS };
    if (offset) opts.offset = offset;

    const response = await client.getCustomFieldsForWorkspace(
      workspaceGid,
      opts,
    );
    if (Array.isArray(response?.data)) collected.push(...response.data);

    offset = response?.next_page?.offset;
    if (!offset) break;
  }

  return collected;
}

/**
 * Locate the story-points custom field for a workspace, optionally narrowed to
 * a project.
 *
 * Resolution order:
 * 1. An explicitly configured `ASANA_POINTS_FIELD_GID` (metadata enriched when cheap).
 * 2. The project's own custom-field settings, when `projectGid` is supplied.
 * 3. Workspace-wide custom fields.
 *
 * @returns the field, or `null` when the team has no points field configured.
 *          Never throws.
 */
export async function resolvePointsField(
  client: AsanaClientWrapper,
  workspaceGid: string,
  projectGid?: string,
): Promise<PointsField | null> {
  // 1. Explicit configuration wins outright.
  if (pointsFieldGid) {
    try {
      const fields = await listWorkspaceCustomFields(client, workspaceGid);
      const match = fields.find((f: any) => f?.gid === pointsFieldGid);
      const enriched = match ? toPointsField(match) : null;
      if (enriched) return enriched;
    } catch {
      // Enrichment is best-effort; the configured GID is still authoritative.
    }
    return { gid: pointsFieldGid, name: FALLBACK_NAME, type: FALLBACK_TYPE };
  }

  const pattern = namePatternRegex();
  if (!pattern) return null;

  // 2. Project-scoped discovery — the most accurate signal when available.
  if (projectGid) {
    try {
      const settings = await client.getProjectCustomFieldSettings(projectGid, {
        opt_fields:
          "custom_field,custom_field.gid,custom_field.name,custom_field.type",
      });
      const fields = (settings ?? [])
        .map((setting: any) => setting?.custom_field)
        .filter(Boolean);

      const match = pickBestMatch(fields, pattern);
      if (match) return match;
    } catch {
      // Fall through to the workspace-wide search.
    }
  }

  // 3. Workspace-wide discovery.
  try {
    const fields = await listWorkspaceCustomFields(client, workspaceGid);
    return pickBestMatch(fields, pattern);
  } catch {
    return null;
  }
}

/**
 * Pull the first number out of a display string.
 *
 * Handles `"8"`, `"8 points"`, `"~13.5"` and `"1,024"`. Returns `null` when the
 * string carries no numeric content (e.g. an enum label like `"Large"`).
 */
function parseNumericString(value: string): number | null {
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Coerce any custom-field value shape into a number, or `null`. */
function coerceNumeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return parseNumericString(value);
  return null;
}

/**
 * Read a task's points value.
 *
 * Two `custom_fields` shapes exist in this codebase and both are supported:
 *
 * - **Raw Asana array** — `[{ gid, name, type, number_value, display_value, enum_value }]`
 * - **Transformed map** — `{ "Story Points (1201234)": "8" }`, produced by
 *   `AsanaClientWrapper.searchTasks`. Keys are matched on the embedded GID
 *   rather than the name, since names are not unique.
 *
 * @returns the numeric value, or `null` when absent, unset, or unparseable.
 */
export function extractPointsValue(
  task: any,
  field: PointsField | null,
): number | null {
  if (!field) return null;

  const customFields = task?.custom_fields;
  if (!customFields) return null;

  // Shape (a): raw Asana array.
  if (Array.isArray(customFields)) {
    const entry = customFields.find((f: any) => f?.gid === field.gid);
    if (!entry) return null;

    if (entry.number_value !== undefined && entry.number_value !== null) {
      return coerceNumeric(entry.number_value);
    }
    if (entry.enum_value?.name) {
      return coerceNumeric(entry.enum_value.name);
    }
    return coerceNumeric(entry.display_value);
  }

  // Shape (b): the `"Name (gid)"` -> displayValue map.
  if (typeof customFields === "object") {
    const suffix = `(${field.gid})`;
    for (const [key, value] of Object.entries(customFields)) {
      // Enum values are rendered as "Large (enumGid)", so the field gid can sit
      // mid-string; a plain `includes` on the parenthesised gid covers both.
      if (!key.includes(suffix)) continue;
      return coerceNumeric(value);
    }
  }

  return null;
}

/**
 * How much of a task set actually carries a points value.
 *
 * Callers use this to decide whether a velocity number is trustworthy — a
 * 30% coverage ratio makes any burndown chart meaningless.
 *
 * `ratio` is 0 when `total` is 0, so it is always safe to format as a percentage.
 */
export function pointsCoverage(
  tasks: any[],
  field: PointsField | null,
): { withPoints: number; total: number; ratio: number } {
  const list = Array.isArray(tasks) ? tasks : [];
  const total = list.length;

  if (!field || total === 0) return { withPoints: 0, total, ratio: 0 };

  let withPoints = 0;
  for (const task of list) {
    if (extractPointsValue(task, field) !== null) withPoints++;
  }

  return { withPoints, total, ratio: withPoints / total };
}

export type PointScale = "fibonacci" | "tshirt" | "hours";

export const SCALES: Record<PointScale, (string | number)[]> = {
  fibonacci: [1, 2, 3, 5, 8, 13, 21],
  tshirt: ["XS", "S", "M", "L", "XL"],
  hours: [1, 2, 4, 8, 16, 24, 40],
};

/**
 * Numeric ladder backing each non-numeric scale, so "nearest" is well defined.
 * XS=1, S=2, M=3, L=5, XL=8 — the conventional fibonacci mapping.
 */
const SCALE_WEIGHTS: Record<PointScale, number[]> = {
  fibonacci: [1, 2, 3, 5, 8, 13, 21],
  tshirt: [1, 2, 3, 5, 8],
  hours: [1, 2, 4, 8, 16, 24, 40],
};

/**
 * Snap an arbitrary number onto the closest rung of an estimation scale.
 *
 * Ties resolve *upward* — 4 on the fibonacci scale is equidistant from 3 and 5
 * and yields 5. Rounding an estimate down is optimistic, and under-estimation
 * is the failure mode that actually hurts; this also matches the planning-poker
 * convention of taking the higher card when the room is split.
 *
 * Non-finite input returns the smallest value on the scale.
 */
export function nearestScaleValue(
  scale: PointScale,
  raw: number,
): string | number {
  const values = SCALES[scale] ?? SCALES.fibonacci;
  const weights = SCALE_WEIGHTS[scale] ?? SCALE_WEIGHTS.fibonacci;

  if (!Number.isFinite(raw)) return values[0];

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  // Guard against the two tables drifting out of sync: an unweighted rung is
  // skipped entirely rather than participating in the comparison, which
  // matters because `<=` below would otherwise let an Infinity distance win.
  const rungs = Math.min(values.length, weights.length);

  for (let i = 0; i < rungs; i++) {
    const distance = Math.abs(weights[i] - raw);
    // `<=` means a later (higher) rung wins any tie, since weights ascend.
    if (distance <= bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }

  return values[bestIndex];
}
