import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import type { PromptEntry } from "./types.js";

export const projectRisksPrompt: PromptEntry = {
  name: "project-risks",
  description:
    "Scan a project for risk signals (overdue tasks, missing assignees, empty descriptions, milestones at risk) and produce a prioritized risk register with mitigations.",
  readOnly: true,
  argsSchema: {
    project_id: z.string().describe("The GID of the project to analyze"),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const projectId = args?.project_id;
    if (!projectId) throw new Error("Project ID is required");

    const today = new Date().toISOString().slice(0, 10);
    const twoWeeksOut = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const [project, taskCounts, { data: tasks }] = await Promise.all([
      client.getProject(projectId, {
        opt_fields:
          "name,due_date,start_on,owner,owner.name,archived",
      }),
      client.getProjectTaskCounts(projectId, {
        opt_fields:
          "num_tasks,num_completed_tasks,num_incomplete_tasks,num_milestones,num_incomplete_milestones",
      }),
      client.getTasksForProject(projectId, {
        opt_fields:
          "name,completed,assignee,assignee.name,due_on,notes,resource_subtype,num_subtasks",
        limit: 100,
      }),
    ]);

    const incompleteTasks = tasks.filter(
      (t: { completed?: boolean }) => !t.completed,
    );

    // Risk signals
    const overdue = incompleteTasks.filter(
      (t: { due_on?: string | null }) => t.due_on && t.due_on < today,
    );
    const unassigned = incompleteTasks.filter(
      (t: { assignee?: unknown }) => !t.assignee,
    );
    const noDescription = incompleteTasks.filter(
      (t: { notes?: string | null }) => !t.notes || t.notes.trim().length < 20,
    );
    const noDueDate = incompleteTasks.filter(
      (t: { due_on?: string | null }) => !t.due_on,
    );
    const milestones = incompleteTasks.filter(
      (t: { resource_subtype?: string; due_on?: string | null }) =>
        t.resource_subtype === "milestone",
    );
    const milestonesAtRisk = milestones.filter(
      (t: { due_on?: string | null }) => t.due_on && t.due_on <= twoWeeksOut,
    );

    const total = taskCounts.num_tasks ?? 0;
    const completed = taskCounts.num_completed_tasks ?? 0;
    const progress =
      total > 0 ? `${Math.round((completed / total) * 100)}%` : "N/A";

    const daysToDeadline = project.due_date
      ? Math.round(
          (new Date(project.due_date).getTime() - new Date(today).getTime()) /
            (1000 * 60 * 60 * 24),
        )
      : null;

    const formatShortList = (
      items: { name: string; due_on?: string | null; assignee?: { name?: string } | null }[],
      max = 5,
    ) => {
      const shown = items.slice(0, max).map((t) => {
        const due = t.due_on ? ` (due ${t.due_on})` : "";
        const who = t.assignee?.name ? ` — ${t.assignee.name}` : "";
        return `    - ${t.name}${due}${who}`;
      });
      if (items.length > max) shown.push(`    ... and ${items.length - max} more`);
      return shown.join("\n");
    };

    const riskSignals = [];

    if (overdue.length > 0) {
      riskSignals.push(
        `### Overdue Tasks (${overdue.length}) — HIGH RISK
${formatShortList(overdue)}`,
      );
    }
    if (milestonesAtRisk.length > 0) {
      riskSignals.push(
        `### Milestones Due Within 2 Weeks (${milestonesAtRisk.length}) — HIGH RISK
${formatShortList(milestonesAtRisk)}`,
      );
    }
    if (project.due_date && daysToDeadline !== null && daysToDeadline <= 14) {
      riskSignals.push(
        `### Project Deadline Imminent — HIGH RISK
    Project due in ${daysToDeadline} day${daysToDeadline !== 1 ? "s" : ""} (${project.due_date}) with ${progress} complete`,
      );
    }
    if (unassigned.length > 0) {
      riskSignals.push(
        `### Unassigned Tasks (${unassigned.length}) — MEDIUM RISK
${formatShortList(unassigned)}`,
      );
    }
    if (noDescription.length > 0) {
      riskSignals.push(
        `### Tasks Without Descriptions (${noDescription.length}) — MEDIUM RISK
${formatShortList(noDescription)}`,
      );
    }
    if (noDueDate.length > incompleteTasks.length * 0.3) {
      riskSignals.push(
        `### Large Undated Backlog (${noDueDate.length} of ${incompleteTasks.length} tasks have no due date) — LOW-MEDIUM RISK`,
      );
    }

    const riskSection =
      riskSignals.length > 0
        ? riskSignals.join("\n\n")
        : "  No significant risk signals detected";

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Analyze the risk signals in this Asana project and produce a risk register. All data is pre-fetched — do not call any additional tools.

## Project: ${project.name}
- **Progress:** ${progress} complete (${completed}/${total} tasks)
- **Deadline:** ${project.due_date ? `${project.due_date} (${daysToDeadline !== null ? (daysToDeadline >= 0 ? `${daysToDeadline} days away` : `${Math.abs(daysToDeadline)} days overdue`) : ""})` : "None set"}
- **Incomplete milestones:** ${taskCounts.num_incomplete_milestones ?? 0} of ${taskCounts.num_milestones ?? 0}

## Risk Signals

${riskSection}

---
Produce a concise risk register with this structure for each identified risk:

**Risk:** [name]
**Severity:** Critical / High / Medium / Low
**Impact:** What goes wrong if this isn't addressed
**Likelihood:** How likely is this to cause a problem given the current state
**Mitigation:** Specific action to take (who should do what, by when)

Sort risks by severity (Critical first). End with an overall project risk assessment in 2–3 sentences.`,
          },
        },
      ],
    };
  },
};
