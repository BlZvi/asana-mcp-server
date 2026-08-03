import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import { asanaTimezone, resolveWorkspace } from "../config.js";
import { todayISO } from "../lib/dates.js";
import { mapWithConcurrency } from "../lib/rate-limiter.js";
import type { PromptEntry } from "./types.js";

function userMessage(text: string): GetPromptResult {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

const STATUS_LABEL: Record<string, string> = {
  green: "On Track",
  yellow: "At Risk",
  red: "Off Track",
  blue: "On Hold",
};

export const portfolioHealthPrompt: PromptEntry = {
  name: "portfolio-health",
  description:
    "Roll up delivery health across every project in an Asana portfolio: progress, status colour, overdue counts, and ownership. The executive cross-project view — answers 'how is everything going?' in one call.",
  readOnly: true,
  argsSchema: {
    portfolio: z
      .string()
      .optional()
      .describe(
        "Portfolio GID or name. If omitted, lists the available portfolios in the workspace so the user can pick one.",
      ),
    workspace_gid: z
      .string()
      .optional()
      .describe("Workspace GID. Defaults to ASANA_DEFAULT_WORKSPACE_GID."),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const workspaceGid = resolveWorkspace(args?.workspace_gid);
    const input = args?.portfolio?.trim();

    // No portfolio given: list what's available rather than erroring out.
    if (!input) {
      const { data } = await client.getPortfolios(workspaceGid, {
        opt_fields: "name,gid",
      });
      if (data.length === 0) {
        return userMessage(
          `No portfolios were found in this workspace. Tell the user that portfolio health requires at least one portfolio, and suggest \`/project-summary\` for a single project instead.`,
        );
      }
      return userMessage(
        `Multiple portfolios are available. Ask the user which one they want, then re-run \`/portfolio-health\` with it:

${data.map((p: any) => `  - ${p.name} (\`${p.gid}\`)`).join("\n")}`,
      );
    }

    // Accept a GID directly, otherwise match by name.
    let portfolioGid = /^\d{6,}$/.test(input) ? input : null;
    let portfolioName = input;
    if (!portfolioGid) {
      const { data } = await client.getPortfolios(workspaceGid, {
        opt_fields: "name,gid",
      });
      const matches = data.filter((p: any) =>
        (p.name ?? "").toLowerCase().includes(input.toLowerCase()),
      );
      if (matches.length === 0) {
        return userMessage(
          `No portfolio matches "${input}". Available portfolios:\n\n${data.map((p: any) => `  - ${p.name} (\`${p.gid}\`)`).join("\n") || "  (none)"}`,
        );
      }
      if (matches.length > 1) {
        return userMessage(
          `"${input}" matches several portfolios. Ask the user which they meant:\n\n${matches.map((p: any) => `  - ${p.name} (\`${p.gid}\`)`).join("\n")}`,
        );
      }
      portfolioGid = matches[0].gid;
      portfolioName = matches[0].name;
    }

    const { data: projects } = await client.getPortfolioItems(portfolioGid, {
      opt_fields:
        "name,gid,permalink_url,archived,owner.name,due_date,current_status.color,current_status.title,current_status.text",
    });

    const active = projects.filter((p: any) => !p.archived);
    if (active.length === 0) {
      return userMessage(
        `Portfolio **${portfolioName}** contains no active projects. Tell the user this and note that archived projects are excluded.`,
      );
    }

    const today = todayISO(asanaTimezone);

    // Task counts are one request each — bounded concurrency keeps this sane.
    const rows = await mapWithConcurrency(active, 4, async (p: any) => {
      let total = 0;
      let completed = 0;
      let incompleteMilestones = 0;
      try {
        const counts: any = await client.getProjectTaskCounts(p.gid, {
          opt_fields:
            "num_tasks,num_completed_tasks,num_incomplete_tasks,num_milestones,num_incomplete_milestones",
        });
        total = counts?.num_tasks ?? 0;
        completed = counts?.num_completed_tasks ?? 0;
        incompleteMilestones = counts?.num_incomplete_milestones ?? 0;
      } catch {
        // Task counts can 403 on projects the token cannot fully read.
      }
      const pct = total > 0 ? Math.round((completed / total) * 100) : null;
      const color = p.current_status?.color ?? null;
      const overdueProject = p.due_date && p.due_date < today;
      return {
        name: p.name,
        url: p.permalink_url ?? null,
        owner: p.owner?.name ?? "Unowned",
        due: p.due_date ?? null,
        overdueProject,
        pct,
        total,
        completed,
        incompleteMilestones,
        statusLabel: color ? (STATUS_LABEL[color] ?? color) : "No status",
        statusText: p.current_status?.text ?? null,
      };
    });

    const table = rows
      .map((r) => {
        const label = r.url ? `[${r.name}](${r.url})` : r.name;
        const progress = r.pct === null ? "—" : `${r.pct}%`;
        const due = r.due ? `${r.due}${r.overdueProject ? " ⚠" : ""}` : "—";
        return `| ${label} | ${r.statusLabel} | ${progress} | ${r.completed}/${r.total} | ${r.incompleteMilestones} | ${due} | ${r.owner} |`;
      })
      .join("\n");

    const atRisk = rows.filter(
      (r) => r.statusLabel === "At Risk" || r.statusLabel === "Off Track",
    );
    const noStatus = rows.filter((r) => r.statusLabel === "No status");
    const overdue = rows.filter((r) => r.overdueProject);

    const statusNarratives = rows
      .filter((r) => r.statusText)
      .slice(0, 8)
      .map(
        (r) =>
          `  **${r.name}** (${r.statusLabel}): ${String(r.statusText).slice(0, 240)}`,
      )
      .join("\n\n");

    return userMessage(
      `Assess the health of this Asana portfolio. All data is pre-fetched — do not re-fetch it.

## Portfolio: ${portfolioName}
**${active.length} active project${active.length === 1 ? "" : "s"}**
- At risk or off track: ${atRisk.length}
- Past their due date: ${overdue.length}
- No status update posted: ${noStatus.length}

## Projects
| Project | Status | Progress | Tasks | Open milestones | Due | Owner |
|---|---|---:|---:|---:|---|---|
${table}

## Latest Status Narratives
${statusNarratives || "  No projects have posted a status update."}

---
Produce a portfolio health assessment:

1. **Headline** — One sentence a leader could read and immediately know whether to worry.

2. **Needs attention now** — Projects that are off track, overdue, or stalled. For each: what is wrong and what decision or intervention is needed. Be specific about who should act.

3. **Watch list** — Projects that are fine today but trending badly (low progress against a near due date, milestones piling up).

4. **Reporting gaps** — ${noStatus.length > 0 ? `${noStatus.length} project(s) have posted no status. Flag this as a visibility problem — an unreported project is not the same as a healthy one.` : "All projects have reported status."}

5. **Overall** — Portfolio-level verdict in 2–3 sentences.

Do not treat completion percentage alone as health — a project at 90% with an overdue date and no status update is in worse shape than one at 40% that is reporting on track.`,
    );
  },
};
