import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import { asanaTimezone, resolveWorkspace } from "../config.js";
import { addDaysISO, todayISO } from "../lib/dates.js";
import { formatResolveFailure, resolveProjectGid } from "../lib/resolve.js";
import type { PromptEntry } from "./types.js";

function userMessage(text: string): GetPromptResult {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

/**
 * Standard preamble for every code-bridge prompt.
 *
 * These prompts orchestrate two halves: the Asana half is pre-fetched here, and
 * the code half must be gathered by the client's own filesystem/git tooling.
 * This server has no repository access by design — it runs over stdio with only
 * an Asana token. Every prompt must therefore work when no code tools exist.
 */
function codeToolPreamble(commands: string[]): string {
  return `## Gathering the code half

You need repository data to complete this. Use whatever filesystem, git, or shell tools you have available to run:

${commands.map((c) => `\`\`\`bash\n${c}\n\`\`\``).join("\n")}

**If you have no repository access:** do not guess or fabricate. Tell the user exactly which commands to run and ask them to paste the output, then continue from there.`;
}

const TASK_FIELDS =
  "name,permalink_url,completed,completed_at,created_at,assignee.name,due_on,notes,tags.name,memberships.section.name";

async function loadProject(
  client: AsanaClientWrapper,
  input: string | undefined,
  workspaceGid: string,
) {
  if (!input || input.trim() === "") {
    throw new Error("A project name, URL, or GID is required");
  }
  const resolved = await resolveProjectGid(client, input, workspaceGid);
  if (!resolved.ok) return { ok: false as const, resolved };

  const [project, tasks] = await Promise.all([
    client.getProject(resolved.gid, { opt_fields: "name,permalink_url,notes" }),
    client.getTasksForProject(resolved.gid, {
      opt_fields: TASK_FIELDS,
      limit: 100,
    }),
  ]);
  return { ok: true as const, gid: resolved.gid, project, tasks: tasks.data };
}

function renderTasks(tasks: any[], limit = 40): string {
  if (tasks.length === 0) return "  None";
  const shown = tasks.slice(0, limit).map((t: any) => {
    const label = t.permalink_url ? `[${t.name}](${t.permalink_url})` : t.name;
    const who = t.assignee?.name ?? "unassigned";
    const sec = t.memberships?.[0]?.section?.name;
    return `  - ${label} — ${who}${sec ? ` · ${sec}` : ""} · gid \`${t.gid}\``;
  });
  const more =
    tasks.length > limit ? `\n  ...and ${tasks.length - limit} more` : "";
  return shown.join("\n") + more;
}

// ---------------------------------------------------------------------------

export const linkTasksToCodePrompt: PromptEntry = {
  name: "link-tasks-to-code",
  description:
    "Map an Asana project's tasks to the repository's branches and commits. Identifies tasks with no code behind them and commits with no tracked task. Requires the client to have git/filesystem tools; degrades to asking the user to paste git output.",
  readOnly: true,
  argsSchema: {
    project: z
      .string()
      .describe("The Asana project to cross-reference. Name, URL, or GID."),
    since: z
      .string()
      .optional()
      .describe(
        "How far back to read git history, as a git-compatible date (e.g. `30.days`, `2026-01-01`). Defaults to 30 days.",
      ),
    workspace_gid: z
      .string()
      .optional()
      .describe("Workspace GID. Defaults to ASANA_DEFAULT_WORKSPACE_GID."),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const workspaceGid = resolveWorkspace(args?.workspace_gid);
    const loaded = await loadProject(client, args?.project, workspaceGid);
    if (!loaded.ok) {
      return userMessage(
        `Could not cross-reference tasks with code.\n\n${formatResolveFailure(loaded.resolved, "project")}`,
      );
    }

    const since = args?.since?.trim() || "30.days";
    const open = loaded.tasks.filter((t: any) => !t.completed);
    const recentlyDone = loaded.tasks.filter((t: any) => t.completed);

    return userMessage(
      `Cross-reference this Asana project against the repository.

## Project: ${(loaded.project as any).name}

### Open tasks (${open.length})
${renderTasks(open)}

### Completed tasks (${recentlyDone.length})
${renderTasks(recentlyDone, 25)}

${codeToolPreamble([
  `git log --since="${since}" --oneline --no-merges`,
  `git branch -a --format='%(refname:short)'`,
])}

## What to produce

1. **Linked work** — For each task you can tie to a branch or commit, show the pairing. Look for the task GID, an Asana URL, or a \`#<digits>\` reference in branch names and commit subjects. You can also call \`asana_match_tasks_to_refs\` with the git output to resolve references automatically.

2. **Tasks with no code** — Open tasks that have no matching branch or commit. Distinguish between:
   - Tasks that legitimately need no code (design, research, coordination)
   - Tasks that look like engineering work but show no activity — these are the interesting ones

3. **Code with no task** — Commits or branches with no matching Asana task. These represent untracked work.

4. **Suspicious completions** — Tasks marked complete that have no associated commits. Flag these for verification rather than asserting they were not done; the link may simply be missing.

Be explicit about confidence. A commit matched by GID is certain; one matched by fuzzy name similarity is a guess and should be labelled as such.`,
    );
  },
};

// ---------------------------------------------------------------------------

export const techDebtRoadmapPrompt: PromptEntry = {
  name: "tech-debt-roadmap",
  description:
    "Turn in-code debt markers (TODO/FIXME/HACK) and churn hotspots into a reviewable Asana backlog. Pre-fetches existing debt-tagged tasks so proposals are deduplicated against work already tracked. Previews before creating anything.",
  readOnly: false,
  argsSchema: {
    project: z
      .string()
      .describe(
        "The Asana project where debt tasks live (and where new ones would be created). Name, URL, or GID.",
      ),
    path: z
      .string()
      .optional()
      .describe(
        "Repository subdirectory to scan (e.g. `src/`). Defaults to the whole repository.",
      ),
    debt_label: z
      .string()
      .optional()
      .describe(
        "Tag or keyword identifying existing debt tasks, used for deduplication. Defaults to matching `debt`, `refactor`, or `cleanup`.",
      ),
    workspace_gid: z
      .string()
      .optional()
      .describe("Workspace GID. Defaults to ASANA_DEFAULT_WORKSPACE_GID."),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const workspaceGid = resolveWorkspace(args?.workspace_gid);
    const loaded = await loadProject(client, args?.project, workspaceGid);
    if (!loaded.ok) {
      return userMessage(
        `Could not build a tech-debt roadmap.\n\n${formatResolveFailure(loaded.resolved, "project")}`,
      );
    }

    const path = args?.path?.trim() || ".";
    const label = args?.debt_label?.trim() || "debt|refactor|cleanup";
    const labelRe = new RegExp(label, "i");

    const existingDebt = loaded.tasks.filter((t: any) => {
      const tags = (Array.isArray(t.tags) ? t.tags : [])
        .map((x: any) => x?.name ?? "")
        .join(" ");
      return labelRe.test(`${t.name ?? ""} ${tags}`);
    });

    return userMessage(
      `Build a tech-debt roadmap from the codebase, deduplicated against what Asana already tracks.

## Project: ${(loaded.project as any).name}

### Debt-related tasks already in Asana (${existingDebt.length})
${renderTasks(existingDebt, 30)}

These already exist. Do NOT propose duplicates of them.

${codeToolPreamble([
  `grep -rn "TODO\\|FIXME\\|HACK\\|XXX" ${path} --include="*.ts" --include="*.js" --include="*.tsx" --include="*.py" --include="*.go" --include="*.java" | head -200`,
  `git log --since="180.days" --name-only --pretty=format: -- ${path} | sort | uniq -c | sort -rn | head -30`,
])}

## What to produce

**Step 1 — Cluster.** Group the raw markers into coherent themes rather than listing them one by one. A theme is something like "error handling is inconsistent across the API layer", not "line 42 has a TODO". Cross-reference the churn data: files changed frequently AND carrying debt markers are the highest-value targets, because the debt is actively costing time.

**Step 2 — Deduplicate.** Drop anything already covered by the existing Asana tasks listed above. Say explicitly which proposals you dropped and why.

**Step 3 — Present for review.** For each proposed theme give:
- A clear, action-oriented title
- The specific file/line evidence backing it
- Why it matters (what it costs today, not abstract "cleanliness")
- A rough size (S/M/L)

**Step 4 — Confirm before writing.** Show the full proposed list and ask the user which items to create. Do not create anything until they confirm. Ask specifically:
- Any items to drop or merge?
- Anything missing?
- Which section or assignee should these go to?

**Step 5 — Create.** Only after explicit confirmation, use \`asana_create_task\` for each approved item, including the file/line evidence in the task description. Report each created task with its GID and link.`,
    );
  },
};

// ---------------------------------------------------------------------------

export const releaseNotesPrompt: PromptEntry = {
  name: "release-notes",
  description:
    "Generate release notes by combining tasks completed in a window with the commits from the same period. Produces a themed changelog rather than a raw task dump.",
  readOnly: true,
  argsSchema: {
    project: z
      .string()
      .describe("The Asana project to draw completed work from."),
    since: z
      .string()
      .optional()
      .describe(
        "Start of the release window (YYYY-MM-DD). Defaults to 14 days ago.",
      ),
    until: z
      .string()
      .optional()
      .describe("End of the release window (YYYY-MM-DD). Defaults to today."),
    audience: z
      .enum(["users", "internal", "technical"])
      .optional()
      .describe(
        "Who the notes are for: `users` (benefit-led, no jargon), `internal` (team-facing, default), or `technical` (full detail with commit references).",
      ),
    workspace_gid: z
      .string()
      .optional()
      .describe("Workspace GID. Defaults to ASANA_DEFAULT_WORKSPACE_GID."),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const workspaceGid = resolveWorkspace(args?.workspace_gid);
    const loaded = await loadProject(client, args?.project, workspaceGid);
    if (!loaded.ok) {
      return userMessage(
        `Could not generate release notes.\n\n${formatResolveFailure(loaded.resolved, "project")}`,
      );
    }

    const today = todayISO(asanaTimezone);
    const until = /^\d{4}-\d{2}-\d{2}$/.test(args?.until ?? "")
      ? (args?.until as string)
      : today;
    const since = /^\d{4}-\d{2}-\d{2}$/.test(args?.since ?? "")
      ? (args?.since as string)
      : addDaysISO(until, -14);

    const completed = loaded.tasks.filter((t: any) => {
      if (!t.completed) return false;
      const at = (t.completed_at ?? "").slice(0, 10);
      return at >= since && at <= until;
    });

    const audience = args?.audience ?? "internal";
    const audienceGuide: Record<string, string> = {
      users:
        "Write for end users. Lead with what they can now do that they could not before. No internal jargon, no task IDs, no commit hashes. Group by user-visible benefit.",
      internal:
        "Write for the team. Group by theme (features, fixes, infrastructure). Include task links. Keep it scannable.",
      technical:
        "Write for engineers. Include commit references and task links, note breaking changes and migration steps prominently, and call out anything affecting deployment or configuration.",
    };

    if (completed.length === 0) {
      return userMessage(
        `No tasks in **${(loaded.project as any).name}** were completed between ${since} and ${until}.

Tell the user there is nothing to release from Asana's perspective, and suggest either widening the window or checking whether the work is tracked in a different project. If they still want notes, offer to generate them from git history alone.`,
      );
    }

    return userMessage(
      `Generate release notes for this window.

## Project: ${(loaded.project as any).name}
**Window:** ${since} → ${until}

### Completed tasks (${completed.length})
${renderTasks(completed, 60)}

${codeToolPreamble([
  `git log --since="${since}" --until="${until}" --no-merges --pretty=format:'%h %s'`,
])}

## What to produce

**Audience: ${audience}**
${audienceGuide[audience]}

1. **Correlate** the completed tasks with the commits. Tasks are the "why", commits are the "what" — use both. Where a task has no matching commit, still include it if it represents user-visible change.

2. **Group by theme**, not by task order. Typical groupings: new capabilities, improvements, fixes, internal/infrastructure.

3. **Omit noise.** Chores, dependency bumps, and formatting-only commits do not belong in ${audience === "technical" ? "the headline sections — collect them under a brief 'Internal' heading" : "these notes at all"}.

4. **Flag breaking changes** prominently at the top if any exist.

Output the notes as a ready-to-publish document. No meta-commentary, no "here are your release notes" framing.`,
    );
  },
};

// ---------------------------------------------------------------------------

export const roadmapGapAnalysisPrompt: PromptEntry = {
  name: "roadmap-gap-analysis",
  description:
    "Compare what the Asana roadmap claims is done against what the codebase actually supports. Surfaces items marked complete that lack tests, error handling, or documentation.",
  readOnly: true,
  argsSchema: {
    project: z
      .string()
      .describe("The Asana roadmap or delivery project to audit."),
    focus: z
      .string()
      .optional()
      .describe(
        "Optional area to concentrate on (e.g. 'authentication', 'billing'). Narrows both the task set and the code review.",
      ),
    workspace_gid: z
      .string()
      .optional()
      .describe("Workspace GID. Defaults to ASANA_DEFAULT_WORKSPACE_GID."),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const workspaceGid = resolveWorkspace(args?.workspace_gid);
    const loaded = await loadProject(client, args?.project, workspaceGid);
    if (!loaded.ok) {
      return userMessage(
        `Could not run a gap analysis.\n\n${formatResolveFailure(loaded.resolved, "project")}`,
      );
    }

    const focus = args?.focus?.trim();
    const focusRe = focus ? new RegExp(focus, "i") : null;
    const relevant = focusRe
      ? loaded.tasks.filter((t: any) =>
          focusRe.test(`${t.name ?? ""} ${t.notes ?? ""}`),
        )
      : loaded.tasks;

    const done = relevant.filter((t: any) => t.completed);
    const open = relevant.filter((t: any) => !t.completed);

    return userMessage(
      `Audit this Asana roadmap against what the codebase actually implements.

## Project: ${(loaded.project as any).name}${focus ? ` · Focus: ${focus}` : ""}

### Marked complete (${done.length})
${renderTasks(done, 40)}

### Still open (${open.length})
${renderTasks(open, 25)}

${codeToolPreamble([
  `# Locate the modules relevant to the completed items above`,
  `ls -R src 2>/dev/null | head -60`,
  `# Then read the specific files, and check for matching tests:`,
  `find . -path ./node_modules -prune -o -name "*.test.*" -print -o -name "*.spec.*" -print | head -40`,
])}

## What to produce

For each item marked complete, verify it against the code and classify it:

- **Confirmed** — implemented, tested, and handles failure cases
- **Thin** — implemented, but missing tests, error handling, or documentation
- **Not found** — no corresponding implementation located (say where you looked; a miss may mean the code is elsewhere, not that it is absent)

Then produce:

1. **Gap table** — item | classification | evidence | what is missing
2. **Highest-risk gaps** — the 3 "thin" or "not found" items whose failure would hurt most, and why
3. **Recommended follow-up tasks** — concrete work to close the real gaps. Present these for review; do not create them without asking.

Be careful about false negatives. If you could not locate an implementation, say "not located" rather than "not implemented", and state which paths you searched.`,
    );
  },
};

// ---------------------------------------------------------------------------

export const estimateFromCodePrompt: PromptEntry = {
  name: "estimate-from-code",
  description:
    "Estimate an Asana task by examining the actual code that would change, combined with historical comparables. More accurate than title-only estimation because it grounds the estimate in real change surface.",
  readOnly: true,
  argsSchema: {
    task: z.string().describe("The task to estimate. Name, URL, or GID."),
    scale: z
      .enum(["fibonacci", "tshirt", "hours"])
      .optional()
      .describe("Estimation scale. Defaults to `fibonacci`."),
    hint: z
      .string()
      .optional()
      .describe(
        "Optional hint about where the change lands (e.g. 'the auth middleware', 'src/api/'). Speeds up code location.",
      ),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const { findComparables } = await import("../tools/estimation-tools.js");
    const { resolveTaskGid } = await import("../lib/resolve.js");

    const input = args?.task;
    if (!input || input.trim() === "") {
      throw new Error("A task name, URL, or GID is required");
    }

    const resolved = await resolveTaskGid(client, input);
    if (!resolved.ok) {
      return userMessage(
        `Could not estimate.\n\n${formatResolveFailure(resolved, "task")}`,
      );
    }

    const result = await findComparables(client, resolved.gid, undefined, 15);
    const scale = args?.scale ?? "fibonacci";
    const hint = args?.hint?.trim();

    const comparableRows =
      result.comparables.length > 0
        ? result.comparables
            .map((c) => {
              const label = c.permalink_url
                ? `[${c.name}](${c.permalink_url})`
                : c.name;
              return `  - ${label} — ${c.points ?? "no estimate"} pts, actual ${c.cycleTimeDays === null ? "unknown" : `${c.cycleTimeDays.toFixed(1)}d`}`;
            })
            .join("\n")
        : "  No historical comparables found.";

    return userMessage(
      `Estimate this task using BOTH historical comparables and the actual code that would change.

## Target: ${result.target.permalink_url ? `[${result.target.name}](${result.target.permalink_url})` : result.target.name}

### Description
${result.target.notes.slice(0, 1200) || "No description"}

### Historical comparables
${comparableRows}

${codeToolPreamble([
  hint
    ? `# Start from the hint: ${hint}`
    : `# Locate the code this task would touch`,
  `grep -rn "<key terms from the task>" src/ --include="*.ts" | head -30`,
  `# Then read the relevant files and check for existing test coverage`,
])}

## What to produce

1. **Locate the change surface.** Which files and modules would this touch? How large are they? Is there existing test coverage to update?

2. **Assess the real complexity:**
   - Number of files/modules affected
   - Whether it changes a public interface or is purely internal
   - Whether existing tests must be rewritten
   - Whether it touches code with high churn or known fragility

3. **Cross-check against history.** Do the comparables' actual cycle times support your read of the complexity? Where a comparable's estimate and actual diverged sharply, understand why before reusing its number.

4. **Answer on the ${scale} scale** in this format:

\`\`\`
Estimate: <value> (confidence: low | medium | high)

Change surface: <files/modules, roughly how much>
Anchored on: <comparables and why they fit>
Reasoning: <2-3 sentences>
Risk factors: <what would push this larger>
\`\`\`

If you could not access the repository, say so plainly and mark the confidence \`low\` — an estimate without the code half is materially weaker.`,
    );
  },
};

// ---------------------------------------------------------------------------

export const impactAnalysisPrompt: PromptEntry = {
  name: "impact-analysis",
  description:
    "For a proposed change, identify the affected code, related past Asana work, and who last touched the area — to determine blast radius and the right owner.",
  readOnly: true,
  argsSchema: {
    description: z
      .string()
      .describe(
        "What is being proposed or changed. A task name/GID also works, or a free-text description.",
      ),
    workspace_gid: z
      .string()
      .optional()
      .describe("Workspace GID. Defaults to ASANA_DEFAULT_WORKSPACE_GID."),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const workspaceGid = resolveWorkspace(args?.workspace_gid);
    const input = args?.description;
    if (!input || input.trim() === "") {
      throw new Error("A description or task reference is required");
    }

    // Related past work gives the historical context for the blast radius.
    let related: any[] = [];
    try {
      const { data } = await client.searchTasks(workspaceGid, {
        text: input.slice(0, 100),
        opt_fields:
          "name,permalink_url,completed,completed_at,assignee.name,projects.name",
      });
      related = data.slice(0, 15);
    } catch {
      related = [];
    }

    const relatedSection =
      related.length > 0
        ? related
            .map((t: any) => {
              const label = t.permalink_url
                ? `[${t.name}](${t.permalink_url})`
                : t.name;
              const status = t.completed
                ? `completed ${(t.completed_at ?? "").slice(0, 10)}`
                : "open";
              return `  - ${label} — ${status} · ${t.assignee?.name ?? "unassigned"}`;
            })
            .join("\n")
        : "  No related Asana tasks found by text search.";

    return userMessage(
      `Analyze the impact of this proposed change.

## Proposed change
${input}

## Related Asana work
${relatedSection}

${codeToolPreamble([
  `grep -rn "<key terms from the proposal>" src/ --include="*.ts" | head -40`,
  `# For each affected file, find who last worked on it:`,
  `git log -5 --format='%an %ar %s' -- <file>`,
])}

## What to produce

1. **Blast radius** — Which modules, files, and public interfaces are affected? Rate the scope: contained / moderate / wide.

2. **Downstream effects** — What else depends on the code being changed? Call out anything that would break: callers, tests, configuration, database schema, external contracts.

3. **Suggested owner** — Based on \`git log\` authorship of the affected files and on who handled the related Asana tasks above, who is best positioned to do this? Give a name and the evidence. If the code has no recent author, say so — that is itself a risk signal.

4. **Prerequisites** — Anything that must be true or done first.

5. **Risks** — What could go wrong, and what would reduce that risk (feature flag, phased rollout, extra test coverage).

Ground every claim in specific files or specific past tasks. Do not speculate about code you could not read — say what you were unable to check.`,
    );
  },
};
