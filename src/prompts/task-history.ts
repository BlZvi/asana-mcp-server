import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import { businessDays } from "../config.js";
import {
  computeLifecycle,
  computeSignals,
  type Lifecycle,
  type LifecycleSignals,
} from "../lib/lifecycle.js";
import { formatResolveFailure, resolveTaskGid } from "../lib/resolve.js";
import {
  parseStories,
  STORY_OPT_FIELDS,
  type TaskEvent,
} from "../lib/story-parser.js";
import type { PromptEntry } from "./types.js";

/** Everything the lifecycle computation and the rendered header need. */
const TASK_OPT_FIELDS =
  "name,permalink_url,completed,completed_at,created_at,assignee.name,memberships.section.name,memberships.project.name,num_subtasks";

/** Cap on rendered timeline events; long streams are truncated from the front. */
const MAX_RENDERED_EVENTS = 60;
/** Comment bodies are elided past this length to keep the message readable. */
const MAX_COMMENT_CHARS = 240;

/** A single-message prompt result. */
function userMessage(text: string) {
  return {
    messages: [
      { role: "user" as const, content: { type: "text" as const, text } },
    ],
  };
}

/** `2026-07-14 09:31` in UTC — stable and sortable, unlike locale formatting. */
function stamp(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso || "unknown time";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16);
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Render one event as a single narrative line. */
function renderEvent(event: TaskEvent): string {
  const who = event.actor?.name ?? "Someone";
  const when = stamp(event.at);

  let what: string;
  switch (event.kind) {
    case "assignment":
      what = event.to
        ? `assigned it to **${event.to}**`
        : `unassigned it${event.from ? ` (was ${event.from})` : ""}`;
      break;
    case "section":
      what = `moved it ${event.from ? `from *${event.from}* ` : ""}to *${event.to ?? "Unknown"}*`;
      break;
    case "reschedule":
      what = `changed ${event.field ?? "a date"} from ${event.from ?? "none"} to ${event.to ?? "none"}`;
      break;
    case "completion":
      what =
        event.to === "completed"
          ? "marked it **complete**"
          : "**reopened** it (marked incomplete)";
      break;
    case "field":
      what = `changed field *${event.field ?? "unknown"}*${
        event.from || event.to
          ? ` from ${event.from ?? "none"} to ${event.to ?? "none"}`
          : ""
      }`;
      break;
    case "comment":
      what = `commented: "${truncate(event.text ?? "", MAX_COMMENT_CHARS)}"`;
      break;
    case "dependency":
      what = `changed dependencies (${event.raw})`;
      break;
    case "project":
      what =
        event.raw === "added_to_project"
          ? "added it to a project"
          : "removed it from a project";
      break;
    case "rename":
      what = `renamed it from "${event.from ?? "?"}" to "${event.to ?? "?"}"`;
      break;
    default:
      what = `${event.raw}${event.text ? `: ${truncate(event.text, MAX_COMMENT_CHARS)}` : ""}`;
      break;
  }

  return `- ${when} — ${who} ${what}`;
}

/** Markdown table of time spent per section, longest first. */
function renderSectionTable(lifecycle: Lifecycle): string {
  const entries = Object.entries(lifecycle.sectionTotals ?? {});
  if (entries.length === 0) return "_No section history recorded._";

  entries.sort((a, b) => b[1].days - a[1].days);

  const open = lifecycle.sectionIntervals.find((i) => i.exitedAt === null);
  const rows = entries.map(([section, totals]) => {
    const current = open?.section === section ? " (current)" : "";
    return `| ${section}${current} | ${totals.days} | ${totals.businessDays} | ${totals.visits} |`;
  });

  return [
    "| Section | Calendar days | Business days | Visits |",
    "| --- | ---: | ---: | ---: |",
    ...rows,
  ].join("\n");
}

/** Human-readable list of the signals that actually fired. */
function renderSignals(signals: LifecycleSignals): string {
  const lines: string[] = [];

  if (signals.stalled) {
    lines.push(
      `- **Stalled** — sitting in *${signals.stalled.inSection}* for ${signals.stalled.days} business days with no exit.`,
    );
  }
  if (signals.chronicSlip) {
    lines.push(
      `- **Chronic slip** — rescheduled ${signals.chronicSlip.rescheduleCount} times, ${signals.chronicSlip.totalSlipDays} total days pushed out.`,
    );
  }
  if (signals.ownershipChurn) {
    lines.push(
      `- **Ownership churn** — ${signals.ownershipChurn.count} different assignees: ${signals.ownershipChurn.assignees.join(" → ")}.`,
    );
  }
  if (signals.reviewBound) {
    lines.push(
      `- **Review-bound** — ${signals.reviewBound.days} days in review-like sections, ${Math.round(signals.reviewBound.pctOfCycle * 100)}% of total cycle time.`,
    );
  }

  return lines.length > 0 ? lines.join("\n") : "_No risk signals triggered._";
}

/** Reschedule history with slip direction spelled out. */
function renderReschedules(lifecycle: Lifecycle): string {
  const pattern = lifecycle.reschedulePattern ?? [];
  if (pattern.length === 0) return "_Never rescheduled._";

  return pattern
    .map((entry) => {
      const slip =
        typeof entry.slipDays === "number"
          ? entry.slipDays > 0
            ? ` (+${entry.slipDays}d later)`
            : entry.slipDays < 0
              ? ` (${entry.slipDays}d earlier)`
              : " (no net change)"
          : "";
      return `- ${stamp(entry.at)} — ${entry.from ?? "none"} → ${entry.to ?? "none"}${slip}`;
    })
    .join("\n");
}

/** Focus-specific instructions appended to the message. */
function renderInstructions(focus: string): string {
  const common =
    "Ground every claim in a specific dated event from the timeline above. Do not speculate about causes the data does not support, and say so explicitly when the history is too thin to draw a conclusion.";

  if (focus === "delays") {
    return `Analyze **where and why this task lost time**:
1. **Time sinks** — which sections consumed the most time, and whether that is normal for the type of work.
2. **Dead air** — the longest gaps between consecutive events, and what appears to have been waiting on what.
3. **Slip pattern** — whether reschedules were reactive (moved after the due date passed) or planned ahead.
4. **Recoverable time** — the single change that would have removed the most delay.

${common}`;
  }

  if (focus === "handoffs") {
    return `Analyze **ownership and handoffs**:
1. **Ownership chain** — who held the task, in order, and for how long.
2. **Handoff cost** — time lost around each reassignment (gaps between the handoff and the next real activity).
3. **Ping-pong** — any task bouncing back and forth between people or sections, which usually means unclear acceptance criteria.
4. **Accountability** — who owns it now and whether that is the right person given the remaining work.

${common}`;
  }

  return `Produce a **narrative history** of this task:
1. **Story so far** — a short chronological narrative in plain prose, not a bullet dump.
2. **Turning points** — the 2–4 events that actually changed the task's trajectory.
3. **Current state** — where it stands today and what it is waiting on.
4. **What to do next** — one concrete recommendation.

${common}`;
}

export const taskHistoryPrompt: PromptEntry = {
  name: "task-history",
  description:
    "Reconstruct and analyze the full history of an Asana task from its activity stream: section timeline, time spent in each stage, handoffs, reschedules, and risk signals. Pre-fetches the entire lifecycle — no additional tool calls required.",
  readOnly: true,
  argsSchema: {
    task: z
      .string()
      .describe(
        "The task to analyze. A task name, an Asana task URL, or a raw GID all work — names are resolved via typeahead and an ambiguous name returns a disambiguation list.",
      ),
    focus: z
      .enum(["timeline", "delays", "handoffs"])
      .optional()
      .describe(
        "What to emphasize: `timeline` for a chronological narrative (default), `delays` to analyze where time was lost, `handoffs` to analyze ownership churn and reassignment cost.",
      ),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const input = args?.task;
    if (!input || input.trim() === "") {
      throw new Error("A task name, URL, or GID is required");
    }

    const resolved = await resolveTaskGid(client, input);
    if (!resolved.ok) {
      return userMessage(
        `Could not analyze the task history.

${formatResolveFailure(resolved, "task")}

Ask the user which task they meant, then re-run \`/task-history\` with an unambiguous value.`,
      );
    }

    const [task, stories] = await Promise.all([
      client.getTask(resolved.gid, { opt_fields: TASK_OPT_FIELDS }),
      client.getAllStoriesForTask(resolved.gid, {
        opt_fields: STORY_OPT_FIELDS,
      }),
    ]);

    const anyTask = task as any;
    const permalink: string | null = anyTask.permalink_url ?? null;
    const title: string = anyTask.name ?? `Task ${resolved.gid}`;
    const heading = permalink ? `[${title}](${permalink})` : title;

    const events: TaskEvent[] = parseStories(stories.data);
    const currentSection: string | undefined =
      anyTask.memberships?.[0]?.section?.name;
    const projectName: string | undefined =
      anyTask.memberships?.[0]?.project?.name;

    const lifecycle = computeLifecycle(events, anyTask, {
      currentSection,
      businessDays,
    });
    const signals = computeSignals(lifecycle);
    const focus = args?.focus ?? "timeline";

    // Zero stories: the task exists but has no recorded activity at all. There
    // is nothing to narrate, so say so rather than emitting an empty analysis.
    if (events.length === 0) {
      return userMessage(
        `The Asana task ${heading} has **no recorded activity** — its story stream is empty.

- **Created:** ${anyTask.created_at ?? "unknown"}
- **Status:** ${anyTask.completed ? "Complete" : "Incomplete"}
- **Assignee:** ${anyTask.assignee?.name ?? "Unassigned"}
- **Section:** ${currentSection ?? "Unknown"}${projectName ? ` (in ${projectName})` : ""}

There is no history to analyze. Tell the user plainly that Asana has no activity recorded for this task — this usually means it was created programmatically and never touched, or the activity predates the workspace's retention. Do not invent a history. Suggest one concrete next step based on the current state above.`,
      );
    }

    const shown = events.slice(-MAX_RENDERED_EVENTS);
    const omitted = events.length - shown.length;
    const truncationNote =
      omitted > 0
        ? `\n_Showing the ${shown.length} most recent of ${events.length} events; ${omitted} earlier event${omitted === 1 ? "" : "s"} omitted._\n`
        : "";
    const storiesNote = stories.truncated
      ? "\n> ⚠ **Activity stream truncated by Asana pagination limits.** The earliest history is missing, so cycle time and section durations are lower bounds, not exact figures. Flag this caveat in your answer.\n"
      : "";

    const cycle =
      lifecycle.cycleTimeDays !== null
        ? `${lifecycle.cycleTimeDays} days`
        : "n/a (not complete)";
    const lead =
      lifecycle.leadTimeDays !== null
        ? `${lifecycle.leadTimeDays} days`
        : "n/a (not complete)";

    return userMessage(
      `Analyze the complete history of this Asana task. All data is pre-fetched — do not re-fetch it; only call tools to drill into something specific that isn't included.

## Task
- **Name:** ${heading}
- **Status:** ${anyTask.completed ? `Complete (${lifecycle.completedAt ?? anyTask.completed_at ?? "date unknown"})` : "Incomplete"}
- **Assignee:** ${anyTask.assignee?.name ?? "Unassigned"}
- **Current section:** ${currentSection ?? "Unknown"}${projectName ? ` (in ${projectName})` : ""}
- **Created:** ${lifecycle.createdAt ?? "unknown"}
- **Last activity:** ${lifecycle.lastActivityAt ?? "unknown"} (${lifecycle.idleDays} days idle)
- **Subtasks:** ${anyTask.num_subtasks ?? 0}
${storiesNote}
## Flow Metrics
- **Cycle time** (first work → complete): ${cycle}
- **Lead time** (created → complete): ${lead}
- **Reschedules:** ${lifecycle.rescheduleCount}
- **Reassignments:** ${lifecycle.reassignmentCount} across ${lifecycle.assignees.length} distinct assignee${lifecycle.assignees.length === 1 ? "" : "s"}
- **Comments:** ${lifecycle.commentCount}
- **Participants:** ${
        lifecycle.participants.length > 0
          ? lifecycle.participants
              .map((p) => `${p.name} (${p.eventCount})`)
              .join(", ")
          : "none"
      }

## Time in Each Section
${renderSectionTable(lifecycle)}

## Risk Signals
${renderSignals(signals)}

## Reschedule History
${renderReschedules(lifecycle)}

## Event Timeline (${events.length} event${events.length === 1 ? "" : "s"}, oldest first)
${truncationNote}${shown.map(renderEvent).join("\n")}

---
${renderInstructions(focus)}

Reference the task as ${heading} so the link stays clickable.`,
    );
  },
};
