/**
 * Asana story-stream parser.
 *
 * Asana story `text` is localized and unstable (e.g. "moved this Task from Doing
 * to Done" becomes something else entirely in a non-English workspace, and Asana
 * rewords its copy over time). This module therefore reads ONLY the structured
 * `resource_subtype` discriminator plus the structured old/new payload fields.
 * Text is retained solely for comments and for debugging.
 *
 * Pure data transformation: no API calls, no Asana client imports.
 */

/**
 * The opt_fields string callers should pass when fetching stories so that every
 * field this parser reads is actually populated by the API.
 */
export const STORY_OPT_FIELDS =
  "gid,resource_subtype,created_at,created_by.name,created_by.gid,text,old_section.name,new_section.name,old_dates,new_dates,old_name,new_name,old_enum_value.name,new_enum_value.name,custom_field.name,assignee.name,assignee.gid,old_resource_subtype,new_resource_subtype,type";

export type EventKind =
  | "assignment"
  | "section"
  | "reschedule"
  | "completion"
  | "field"
  | "comment"
  | "dependency"
  | "project"
  | "rename"
  | "other";

/** Every EventKind, in a stable order. Used to seed summary records. */
export const EVENT_KINDS: EventKind[] = [
  "assignment",
  "section",
  "reschedule",
  "completion",
  "field",
  "comment",
  "dependency",
  "project",
  "rename",
  "other",
];

export type TaskEvent = {
  gid: string;
  /** ISO timestamp (story.created_at). */
  at: string;
  actor: { gid: string; name: string } | null;
  kind: EventKind;
  from?: string;
  to?: string;
  /** For kind "field": the custom field name. */
  field?: string;
  /** For kind "comment": the comment body. */
  text?: string;
  /** The original resource_subtype (or type), preserved for debugging. */
  raw: string;
};

/** Coerce anything into a trimmed non-empty string, else undefined. */
function str(value: any): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

/** Safely read a nested property off a possibly-null object. */
function prop(obj: any, key: string): any {
  if (obj === null || obj === undefined || typeof obj !== "object") {
    return undefined;
  }
  return obj[key];
}

function actorOf(story: any): { gid: string; name: string } | null {
  const by = prop(story, "created_by");
  if (!by) return null;
  const gid = str(prop(by, "gid"));
  const name = str(prop(by, "name"));
  if (!gid && !name) return null;
  return { gid: gid ?? "", name: name ?? "Unknown" };
}

/**
 * Numeric sort key for an ISO timestamp. Unparseable/missing timestamps sort
 * first (so they never mask real ordering) but never throw.
 */
function timeKey(iso: string): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * Map a single Asana story into a TaskEvent.
 *
 * Never throws. Unknown subtypes degrade to kind "other" with `raw` preserved,
 * because Asana introduces new resource_subtypes over time and a parser that
 * throws on them would break every consumer.
 */
function parseStory(story: any): TaskEvent | null {
  if (story === null || story === undefined || typeof story !== "object") {
    return null;
  }

  // resource_subtype is the reliable discriminator; some payloads (notably
  // comments) only carry the legacy `type` field, so fall back to it.
  const raw = str(story.resource_subtype) ?? str(story.type) ?? "unknown";

  const event: TaskEvent = {
    gid: str(story.gid) ?? "",
    at: str(story.created_at) ?? "",
    actor: actorOf(story),
    kind: "other",
    raw,
  };

  switch (raw) {
    case "assigned": {
      event.kind = "assignment";
      event.to = str(prop(story, "assignee")?.name) ?? str(story.new_name);
      break;
    }
    case "unassigned": {
      event.kind = "assignment";
      // `to` intentionally left undefined: undefined means "nobody".
      event.from = str(prop(story, "assignee")?.name) ?? str(story.old_name);
      break;
    }
    case "section_changed": {
      event.kind = "section";
      event.from = str(prop(story, "old_section")?.name);
      event.to = str(prop(story, "new_section")?.name);
      break;
    }
    case "due_date_changed": {
      event.kind = "reschedule";
      event.field = "due_on";
      event.from = str(prop(story, "old_dates")?.due_on);
      event.to = str(prop(story, "new_dates")?.due_on);
      break;
    }
    case "start_date_changed": {
      event.kind = "reschedule";
      event.field = "start_on";
      event.from = str(prop(story, "old_dates")?.start_on);
      event.to = str(prop(story, "new_dates")?.start_on);
      break;
    }
    case "marked_complete": {
      event.kind = "completion";
      event.to = "completed";
      break;
    }
    case "marked_incomplete": {
      event.kind = "completion";
      event.to = "incomplete";
      break;
    }
    case "enum_custom_field_changed": {
      event.kind = "field";
      event.field = str(prop(story, "custom_field")?.name);
      event.from = str(prop(story, "old_enum_value")?.name);
      event.to = str(prop(story, "new_enum_value")?.name);
      break;
    }
    case "number_custom_field_changed":
    case "text_custom_field_changed":
    case "date_custom_field_changed": {
      event.kind = "field";
      event.field = str(prop(story, "custom_field")?.name);
      break;
    }
    case "comment":
    case "comment_added": {
      event.kind = "comment";
      event.text = str(story.text);
      break;
    }
    case "dependency_added":
    case "dependency_removed":
    case "dependency_marked_complete": {
      event.kind = "dependency";
      break;
    }
    case "added_to_project":
    case "removed_from_project": {
      event.kind = "project";
      break;
    }
    case "name_changed": {
      event.kind = "rename";
      event.from = str(story.old_name);
      event.to = str(story.new_name);
      break;
    }
    default: {
      // Unknown subtype: keep `raw` so callers can still inspect it.
      event.kind = "other";
      const text = str(story.text);
      if (text) event.text = text;
      break;
    }
  }

  return event;
}

/**
 * Parse a raw Asana story array into normalized TaskEvents, sorted ascending by
 * timestamp. Non-object entries are skipped. Never throws.
 */
export function parseStories(stories: any[]): TaskEvent[] {
  if (!Array.isArray(stories)) return [];

  const parsed: { event: TaskEvent; index: number }[] = [];
  for (let i = 0; i < stories.length; i++) {
    const event = parseStory(stories[i]);
    if (event) parsed.push({ event, index: i });
  }

  // Stable ascending sort by timestamp; original order breaks ties so that
  // same-second stories keep the order Asana returned them in.
  parsed.sort((a, b) => {
    const delta = timeKey(a.event.at) - timeKey(b.event.at);
    if (delta !== 0 && Number.isFinite(delta)) return delta;
    if (delta !== 0) return delta < 0 ? -1 : 1;
    return a.index - b.index;
  });

  return parsed.map((p) => p.event);
}

/** Count events per kind. Every EventKind is present, defaulting to 0. */
export function summarizeEvents(
  events: TaskEvent[],
): Record<EventKind, number> {
  const summary = {} as Record<EventKind, number>;
  for (const kind of EVENT_KINDS) summary[kind] = 0;
  if (!Array.isArray(events)) return summary;
  for (const event of events) {
    const kind = event?.kind;
    if (kind && kind in summary) summary[kind] += 1;
    else summary.other += 1;
  }
  return summary;
}

/**
 * Distinct actors across the event stream, sorted by event count descending
 * (name ascending as a tie-break for deterministic output).
 */
export function participantsFrom(
  events: TaskEvent[],
): { gid: string; name: string; eventCount: number }[] {
  if (!Array.isArray(events)) return [];

  const byKey = new Map<
    string,
    { gid: string; name: string; eventCount: number }
  >();
  for (const event of events) {
    const actor = event?.actor;
    if (!actor) continue;
    // Prefer gid as identity; fall back to name for actors returned without one.
    const key = actor.gid || `name:${actor.name}`;
    if (!key || key === "name:") continue;
    const existing = byKey.get(key);
    if (existing) existing.eventCount += 1;
    else byKey.set(key, { gid: actor.gid, name: actor.name, eventCount: 1 });
  }

  return [...byKey.values()].sort(
    (a, b) => b.eventCount - a.eventCount || a.name.localeCompare(b.name),
  );
}
