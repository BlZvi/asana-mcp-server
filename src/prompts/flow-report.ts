import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import { formatResolveFailure, resolveProjectGid } from "../lib/resolve.js";
import {
  computeFlowMetrics,
  type FlowMetrics,
  normalizeSince,
} from "../tools/history-tools.js";
import type { PromptEntry } from "./types.js";

const DEFAULT_SAMPLE = 50;
const MIN_SAMPLE = 5;
const MAX_SAMPLE = 100;

/** Wrap text as the single pre-fetched user message this prompt returns. */
function userMessage(text: string): GetPromptResult {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

/**
 * Parse `max_tasks` defensively. Prompt arguments arrive as strings and users
 * do send junk; NaN must never reach the sampler as a task count.
 */
function parseSample(input: unknown): number {
  if (typeof input !== "string" || input.trim() === "") return DEFAULT_SAMPLE;
  const parsed = Number.parseInt(input.trim(), 10);
  if (Number.isNaN(parsed)) return DEFAULT_SAMPLE;
  return Math.min(MAX_SAMPLE, Math.max(MIN_SAMPLE, parsed));
}

/** Render a day count, or an em dash when the sample was too small to compute. */
const days = (n: number | null): string =>
  n === null ? "—" : `${n.toFixed(1)}d`;

const pct = (n: number | null): string =>
  n === null ? "—" : `${Math.round(n * 100)}%`;

/** A markdown link when a permalink exists, plain text otherwise. */
function link(ref: { name: string; permalink_url: string | null }): string {
  return ref.permalink_url ? `[${ref.name}](${ref.permalink_url})` : ref.name;
}

function renderBottlenecks(m: FlowMetrics): string {
  if (m.sectionBottlenecks.length === 0) {
    return "  No section transitions recorded in the sample.";
  }
  const rows = m.sectionBottlenecks
    .map(
      (b) =>
        `| ${b.section} | ${days(b.p50Days)} | ${days(b.p85Days)} | ${b.taskCount} |`,
    )
    .join("\n");
  return `| Section | Median | p85 | Tasks |\n|---|---:|---:|---:|\n${rows}`;
}

function renderThroughput(m: FlowMetrics): string {
  if (m.throughputByWeek.length === 0) return "  No completions in the window.";
  return m.throughputByWeek
    .map((w) => `  - Week of ${w.weekStart}: ${w.completed} completed`)
    .join("\n");
}

function renderOffenders(m: FlowMetrics): string {
  const parts: string[] = [];

  if (m.worstOffenders.mostRescheduled.length > 0) {
    parts.push(
      `**Most rescheduled**\n${m.worstOffenders.mostRescheduled
        .map((t) => `  - ${link(t)} — ${t.rescheduleCount} reschedules`)
        .join("\n")}`,
    );
  }
  if (m.worstOffenders.longestCycle.length > 0) {
    parts.push(
      `**Longest cycle time**\n${m.worstOffenders.longestCycle
        .map((t) => `  - ${link(t)} — ${t.cycleTimeDays.toFixed(1)} days`)
        .join("\n")}`,
    );
  }
  if (m.worstOffenders.mostChurned.length > 0) {
    parts.push(
      `**Most ownership churn**\n${m.worstOffenders.mostChurned
        .map((t) => `  - ${link(t)} — ${t.assigneeCount} assignees`)
        .join("\n")}`,
    );
  }

  return parts.length > 0 ? parts.join("\n\n") : "  Nothing notable.";
}

/**
 * Coverage footer. This is mandatory output, not decoration: percentile
 * statistics computed over a partial sample are easy to mistake for
 * project-wide truth, so every report states exactly what it measured.
 */
function renderCoverage(m: FlowMetrics): string {
  const { tasks, of, complete, budgetExhausted } = m.sampled;
  const lines = [
    `Based on **${tasks}** completed task${tasks === 1 ? "" : "s"} sampled from **${of}** completed since ${m.completedSince}.`,
  ];
  if (!complete) {
    lines.push(
      `⚠ The sample is a SUBSET of completed work — percentiles describe the sample, not the whole project.`,
    );
  }
  if (budgetExhausted) {
    lines.push(
      `⚠ The API request budget was exhausted before sampling finished. Re-run with a smaller \`max_tasks\` or a more recent \`completed_since\` for a complete picture.`,
    );
  }
  if (complete && !budgetExhausted) {
    lines.push(`Every completed task in the window was analyzed.`);
  }
  return lines.join("\n");
}

export const flowReportPrompt: PromptEntry = {
  name: "flow-report",
  description:
    "Analyze delivery flow for an Asana project: cycle/lead time percentiles, which workflow sections are bottlenecks, weekly throughput, reschedule rates, and the worst-offending tasks. Reconstructs history from each task's activity stream. Costs roughly one API request per sampled task.",
  readOnly: true,
  argsSchema: {
    project: z
      .string()
      .describe(
        "The project to analyze. A project name, an Asana project URL, or a raw GID all work — names are resolved via typeahead and an ambiguous name returns a disambiguation list.",
      ),
    completed_since: z
      .string()
      .optional()
      .describe(
        "Only analyze tasks completed on or after this date (YYYY-MM-DD). Defaults to 90 days ago. A shorter window samples faster and reflects current process; a longer one is more statistically stable.",
      ),
    max_tasks: z
      .string()
      .optional()
      .describe(
        `Maximum tasks to sample (${MIN_SAMPLE}–${MAX_SAMPLE}, default ${DEFAULT_SAMPLE}). Each sampled task costs about one API request, so raise this only when you need tighter percentiles.`,
      ),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const input = args?.project;
    if (!input || input.trim() === "") {
      throw new Error("A project name, URL, or GID is required");
    }

    const resolved = await resolveProjectGid(client, input);
    if (!resolved.ok) {
      return userMessage(
        `Could not produce a flow report.

${formatResolveFailure(resolved, "project")}

Ask the user which project they meant, then re-run \`/flow-report\` with an unambiguous value.`,
      );
    }

    const since = normalizeSince(args?.completed_since);
    const sample = parseSample(args?.max_tasks);

    const m = await computeFlowMetrics(client, resolved.gid, since, sample);

    const projectHeading = m.project.permalink_url
      ? `[${m.project.name}](${m.project.permalink_url})`
      : m.project.name;

    // Nothing completed in the window: percentiles over an empty set are
    // meaningless, so report the gap instead of emitting a table of dashes.
    if (m.sampled.tasks === 0) {
      return userMessage(
        `No completed tasks found in project ${projectHeading} since ${since}, so there is no flow data to analyze.

Suggest to the user:
- Widen the window with an earlier \`completed_since\`
- Confirm the team marks tasks complete in Asana rather than only moving them to a "Done" section
- Check whether this project is actively used`,
      );
    }

    return userMessage(
      `Analyze delivery flow for this Asana project. All data is pre-fetched — do not re-fetch it. Only call tools to drill into something specific that is not included below.

## Project: ${projectHeading}
Completed tasks since **${since}**

## Cycle Time (first work started → completed)
- **Median (p50):** ${days(m.cycleTime.p50)}
- **p85:** ${days(m.cycleTime.p85)}
- **p95:** ${days(m.cycleTime.p95)}
- **Mean:** ${days(m.cycleTime.mean)} (secondary — cycle time is right-skewed, prefer the median)

## Lead Time (created → completed)
- **Median (p50):** ${days(m.leadTime.p50)}
- **p85:** ${days(m.leadTime.p85)}
- **p95:** ${days(m.leadTime.p95)}

## Time in Section — where work waits
${renderBottlenecks(m)}

## Weekly Throughput
${renderThroughput(m)}

## Reschedules
- **Tasks affected:** ${m.reschedule.tasksAffected} (${pct(m.reschedule.pctOfTasks)} of the sample)
- **Median slip when rescheduled:** ${days(m.reschedule.medianSlipDays)}

## Worst Offenders
${renderOffenders(m)}

---
## Coverage
${renderCoverage(m)}

---
Produce a flow analysis with these sections:

1. **Headline** — One sentence: how fast does work actually move through this project, and is that healthy?

2. **Where flow breaks down** — Identify the bottleneck section using the time-in-section table. Compare the p50/p85 gap: a wide gap means high variability (unpredictable delivery), a narrow one means consistency. Say which it is.

3. **Highest-leverage intervention** — Exactly ONE concrete change that would most improve flow, and the evidence for it. Not a list — pick the single best one and justify the choice.

4. **Predictability** — Given p85 cycle time, what commitment could this team make with reasonable confidence? Express it as a range.

5. **Data sufficiency** — State plainly whether the sample is large enough to trust these numbers. If coverage is partial or the sample is under ~20 tasks, say the conclusions are directional only and recommend how to get a better read.

Cite specific tasks (with their links) as evidence wherever you make a claim.`,
    );
  },
};
