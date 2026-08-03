import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import { type PointScale, SCALES } from "../lib/points.js";
import { formatResolveFailure, resolveTaskGid } from "../lib/resolve.js";
import { type Comparable, findComparables } from "../tools/estimation-tools.js";
import type { PromptEntry } from "./types.js";

function userMessage(text: string): GetPromptResult {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

function parseBool(raw: unknown, def: boolean): boolean {
  if (typeof raw !== "string" || raw.trim() === "") return def;
  const v = raw.trim().toLowerCase();
  if (v === "false" || v === "no" || v === "0") return false;
  if (v === "true" || v === "yes" || v === "1") return true;
  return def;
}

function renderComparables(list: Comparable[]): string {
  if (list.length === 0) {
    return "  No completed tasks in this project were similar enough to use as anchors.";
  }
  const rows = list
    .map((c) => {
      const label = c.permalink_url
        ? `[${c.name}](${c.permalink_url})`
        : c.name;
      const pts = c.points === null ? "—" : String(c.points);
      const cycle =
        c.cycleTimeDays === null ? "—" : `${c.cycleTimeDays.toFixed(1)}d`;
      return `| ${label} | ${pts} | ${cycle} | ${c.matchReasons.join("; ") || "—"} |`;
    })
    .join("\n");
  return `| Task | Est. points | Actual cycle time | Why it matched |\n|---|---:|---:|---|\n${rows}`;
}

export const estimatePrompt: PromptEntry = {
  name: "estimate",
  description:
    "Estimate an Asana task by anchoring on completed work of similar shape (reference-class forecasting). Pre-fetches comparable tasks with both their original estimates and their ACTUAL cycle times, so the estimate corrects for historical bias instead of inheriting it. Supports a planning-poker mode for team discussion.",
  readOnly: true,
  argsSchema: {
    task: z
      .string()
      .describe(
        "The task to estimate. A task name, an Asana URL, or a raw GID all work.",
      ),
    scale: z
      .enum(["fibonacci", "tshirt", "hours"])
      .optional()
      .describe(
        "Estimation scale to answer in: `fibonacci` (1,2,3,5,8,13,21 — default), `tshirt` (XS–XL), or `hours`.",
      ),
    show_comparables: z
      .string()
      .optional()
      .describe(
        "`true` (default) or `false`. When true, the reasoning must cite the specific historical tasks it anchored on.",
      ),
    poker_mode: z
      .string()
      .optional()
      .describe(
        "`true` or `false` (default). In poker mode the model commits to an estimate FIRST, then invites the user's number and discusses only where they diverge.",
      ),
    project: z
      .string()
      .optional()
      .describe(
        "Project GID to draw comparables from. Defaults to the task's own project.",
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
        `Could not produce an estimate.

${formatResolveFailure(resolved, "task")}

Ask the user which task they meant, then re-run \`/estimate\`.`,
      );
    }

    const scale = (args?.scale ?? "fibonacci") as PointScale;
    const showComparables = parseBool(args?.show_comparables, true);
    const poker = parseBool(args?.poker_mode, false);

    const result = await findComparables(
      client,
      resolved.gid,
      args?.project,
      25,
    );

    const heading = result.target.permalink_url
      ? `[${result.target.name}](${result.target.permalink_url})`
      : result.target.name;

    const withPoints = result.comparables.filter((c) => c.points !== null);
    const withCycle = result.comparables.filter(
      (c) => c.cycleTimeDays !== null,
    );

    const anchorWarning =
      withPoints.length === 0
        ? `\n⚠ **No comparable task has a recorded estimate.** There is no historical anchor, so any number here is a guess informed only by the task description. Say so explicitly and give a wide range rather than a false-precision point estimate.`
        : withPoints.length < 3
          ? `\n⚠ Only ${withPoints.length} comparable task${withPoints.length === 1 ? " has" : "s have"} a recorded estimate — the anchor is weak. Reflect that in the confidence level.`
          : "";

    const pokerSection = poker
      ? `
## Planning Poker Mode

1. Commit to your estimate NOW, before asking the user anything. State it plainly with your reasoning.
2. Then ask the user for their independent estimate.
3. If the two are within one step on the scale, note the agreement and stop — there is nothing to discuss.
4. If they diverge by more than one step, do NOT average them. Identify which specific comparable tasks or risk factors explain the gap, and surface those for discussion. The point of the exercise is the disagreement, not the number.
5. Never write the estimate back to Asana — this prompt is read-only by design.`
      : `
Do NOT write the estimate back to Asana. Report it and let the user decide.`;

    return userMessage(
      `Estimate this Asana task using reference-class forecasting. All data is pre-fetched — do not re-fetch it.

## Target Task: ${heading}
- **Section:** ${result.target.section || "None"}
- **Tags:** ${result.target.tags.join(", ") || "None"}

### Description
${result.target.notes.slice(0, 1200) || "No description"}${result.target.notes.length > 1200 ? "\n[...truncated]" : ""}

## Comparable Completed Work
${showComparables ? renderComparables(result.comparables) : `  ${result.comparables.length} comparables found (display suppressed).`}

**Points field:** ${result.pointsField ? result.pointsField.name : "None configured for this project"}
**Coverage:** scanned ${result.coverage.candidatesScanned} completed tasks, ${result.coverage.withPoints} had an estimate recorded, ${withCycle.length} had a computable cycle time.${anchorWarning}

## Scale
Answer on the **${scale}** scale: ${SCALES[scale].join(", ")}

---
## How to estimate

1. **Compare the target to the anchors.** Pick the 2–4 comparables closest in shape and say why they are the right reference class.

2. **Check where past estimates were wrong.** The "actual cycle time" column is the key signal. If tasks estimated at N consistently took much longer than tasks estimated at N-1 would suggest, the team's historical estimates are biased low — correct for that rather than reproducing it.

3. **Give your answer in exactly this format:**

\`\`\`
Estimate: <value> (confidence: low | medium | high)

Anchored on:
  - <task name> — <points> pts, took <N> days
  - <task name> — <points> pts, took <N> days

Reasoning: <2–3 sentences>
Risk factors: <what would push this to the next size up>
\`\`\`

4. **Be honest about uncertainty.** Confidence is \`low\` when fewer than 3 anchors have estimates, when cycle times among anchors vary by more than 3x, or when the task description is too thin to judge scope.
${pokerSection}`,
    );
  },
};
