import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import type { PromptEntry } from "./types.js";
import { todayISO } from "./types.js";

export const sprintPlanningPrompt: PromptEntry = {
  name: "sprint-planning",
  description:
    "Plan a sprint from a project's backlog. Pre-fetches incomplete tasks, then guides selection, assignment, and sprint goal definition based on team capacity.",
  readOnly: true,
  argsSchema: {
    project_id: z
      .string()
      .describe("The GID of the project to plan a sprint for"),
    sprint_duration_days: z
      .string()
      .optional()
      .describe("Length of the sprint in days (default: 14)"),
    team: z
      .string()
      .optional()
      .describe(
        "Comma-separated list of team member names who will work on this sprint (e.g. 'Alice, Bob, Carol')",
      ),
    capacity_days_per_person: z
      .string()
      .optional()
      .describe(
        "Available working days per person for this sprint (default: sprint_duration_days × 0.8 to account for overhead)",
      ),
    focus: z
      .string()
      .optional()
      .describe(
        "Optional sprint theme or goal direction (e.g. 'ship the checkout feature', 'reduce bug count')",
      ),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const projectId = args?.project_id;
    if (!projectId) throw new Error("Project ID is required");

    const sprintDays = Number.parseInt(args?.sprint_duration_days ?? "14", 10);
    const team = args?.team
      ? args.team
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const capacityDays = args?.capacity_days_per_person
      ? Number.parseFloat(args.capacity_days_per_person)
      : Math.round(sprintDays * 0.8);
    const focus = args?.focus;

    const today = todayISO();
    const sprintEnd = new Date(Date.now() + sprintDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const [project, , { data: tasks }] = await Promise.all([
      client.getProject(projectId, {
        opt_fields: "name,team,team.name",
      }),
      client.getProjectSections(projectId, {
        opt_fields: "name",
      }),
      client.getTasksForProject(projectId, {
        opt_fields:
          "name,completed,assignee,assignee.name,due_on,notes,memberships,memberships.section,memberships.section.name",
        limit: 100,
      }),
    ]);

    const incompleteTasks = tasks.filter(
      (t: { completed?: boolean }) => !t.completed,
    );
    const overdue = incompleteTasks.filter(
      (t: { due_on?: string | null }) => t.due_on && t.due_on < today,
    );
    const dueDuringSprint = incompleteTasks.filter(
      (t: { due_on?: string | null }) =>
        t.due_on && t.due_on >= today && t.due_on <= sprintEnd,
    );
    const noDueDate = incompleteTasks.filter(
      (t: { due_on?: string | null }) => !t.due_on,
    );

    const formatTask = (t: {
      name: string;
      due_on?: string | null;
      assignee?: { name?: string } | null;
      memberships?: { section?: { name?: string } }[];
    }) => {
      const section = t.memberships?.[0]?.section?.name ?? "";
      const assignee = t.assignee?.name ?? "unassigned";
      const due = t.due_on ? ` · due ${t.due_on}` : "";
      const sec = section ? ` [${section}]` : "";
      return `  - ${t.name}${sec} · ${assignee}${due}`;
    };

    const overdueSection =
      overdue.length > 0 ? overdue.map(formatTask).join("\n") : "  None";

    const sprintSection =
      dueDuringSprint.length > 0
        ? dueDuringSprint.map(formatTask).join("\n")
        : "  None";

    const backlogSection =
      noDueDate.length > 0
        ? noDueDate.slice(0, 20).map(formatTask).join("\n") +
          (noDueDate.length > 20
            ? `\n  ... and ${noDueDate.length - 20} more`
            : "")
        : "  None";

    const teamSection =
      team.length > 0
        ? `- **Team members:** ${team.join(", ")}\n- **Capacity per person:** ~${capacityDays} working days`
        : `- **Team:** Not specified (provide team members for assignment recommendations)\n- **Capacity per person:** ~${capacityDays} working days`;

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Help plan a sprint for this project. All data is pre-fetched — do not call any additional tools.\n\n## Sprint Parameters\n- **Project:** ${project.name}${project.team?.name ? ` (${project.team.name})` : ""}\n- **Sprint duration:** ${sprintDays} days (${today} → ${sprintEnd})\n${teamSection}${focus ? `\n- **Sprint focus:** ${focus}` : ""}\n\n## Backlog Overview (${incompleteTasks.length} incomplete tasks)\n\n### Overdue — Must address (${overdue.length})\n${overdueSection}\n\n### Due during sprint window (${dueDuringSprint.length})\n${sprintSection}\n\n### No due date — Candidate backlog (${noDueDate.length})\n${backlogSection}\n\n---\n## Sprint Planning Process\n\n1. **Clarify the sprint goal** — If a focus is provided, refine it into a crisp 1-sentence sprint goal. If not, ask what the team wants to achieve.\n\n2. **Select sprint tasks** — Recommend which tasks to commit to, explaining why each earns a spot:\n   - All overdue items that are still relevant\n   - Due-during-sprint items\n   - High-priority backlog items that fit the sprint goal\n\n3. **Assign work** (if team members are specified):${team.length > 0 ? `\n   - Distribute tasks across: ${team.join(", ")}\n   - Balance load within ~${capacityDays} days per person\n   - Note where skills or context make a specific assignment clear` : "\n   - Team members were not specified — flag which tasks need owners"}\n\n4. **Flag risks:**\n   - Tasks that are too vague to commit to\n   - Dependencies that could block sprint completion\n   - Overdue items that may need to be dropped instead of carried forward\n\n5. **Produce the sprint plan** as a structured list: Sprint Goal + committed tasks per person + any tasks explicitly deferred.`,
          },
        },
      ],
    };
  },
};
