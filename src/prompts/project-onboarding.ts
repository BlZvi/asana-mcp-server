import { z } from "zod";
import type { AsanaClientWrapper } from "../asana-client-wrapper.js";
import type { PromptEntry } from "./types.js";
import { todayISO } from "./types.js";

export const projectOnboardingPrompt: PromptEntry = {
  name: "project-onboarding",
  description:
    "Generate a 'getting up to speed' brief for someone new to a project. Pre-fetches project details, structure, active tasks, and recent status updates.",
  readOnly: true,
  argsSchema: {
    project_id: z.string().describe("The GID of the project"),
    person_role: z
      .string()
      .optional()
      .describe(
        "The role or perspective of the person onboarding (e.g. 'engineer', 'PM', 'stakeholder') to tailor the brief",
      ),
  },
  handler: async (client: AsanaClientWrapper, args) => {
    const projectId = args?.project_id;
    if (!projectId) throw new Error("Project ID is required");

    const personRole = args?.person_role;
    const today = todayISO();

    const [
      project,
      taskCounts,
      { data: sections },
      { data: tasks },
      { data: statuses },
    ] = await Promise.all([
      client.getProject(projectId, {
        opt_fields:
          "name,notes,owner,owner.name,team,team.name,due_date,start_on,current_status,current_status.text,current_status.color,current_status.title",
      }),
      client.getProjectTaskCounts(projectId, {
        opt_fields:
          "num_tasks,num_completed_tasks,num_incomplete_tasks,num_milestones,num_incomplete_milestones",
      }),
      client.getProjectSections(projectId, {
        opt_fields: "name",
      }),
      client.getTasksForProject(projectId, {
        opt_fields:
          "name,completed,assignee,assignee.name,due_on,notes,memberships,memberships.section,memberships.section.name",
        limit: 50,
      }),
      client.getProjectStatusesForProject(projectId, {
        opt_fields: "text,color,title,author,author.name,created_at",
        limit: 3,
      }),
    ]);

    const total = taskCounts.num_tasks ?? 0;
    const completed = taskCounts.num_completed_tasks ?? 0;
    const progress =
      total > 0 ? `${Math.round((completed / total) * 100)}%` : "N/A";

    const incompleteTasks = tasks.filter(
      (t: { completed?: boolean }) => !t.completed,
    );
    const overdue = incompleteTasks.filter(
      (t: { due_on?: string | null }) => t.due_on && t.due_on < today,
    );

    // Build section → task map
    const sectionTaskMap = new Map<string, string[]>();
    for (const section of sections) {
      sectionTaskMap.set(section.name, []);
    }

    for (const task of incompleteTasks.slice(0, 30)) {
      const sectionName = task.memberships?.[0]?.section?.name ?? "No Section";
      const names = sectionTaskMap.get(sectionName) ?? [];
      names.push(task.name);
      sectionTaskMap.set(sectionName, names);
    }

    const structureSection = [...sectionTaskMap.entries()]
      .filter(([, taskNames]) => taskNames.length > 0)
      .map(([sectionName, taskNames]) => {
        const listed = taskNames
          .slice(0, 5)
          .map((n) => `    - ${n}`)
          .join("\n");
        const more =
          taskNames.length > 5
            ? `
    ... and ${taskNames.length - 5} more`
            : "";
        return `  **${sectionName}** (${taskNames.length} active tasks)
${listed}${more}`;
      })
      .join("\n\n");

    // Unique team members from assignees
    const memberMap = new Map<string, string>();
    for (const task of tasks) {
      if (task.assignee?.name && task.assignee?.gid) {
        memberMap.set(task.assignee.gid, task.assignee.name);
      }
    }
    const teamMembers = [...memberMap.values()].sort();

    const statusColors: Record<string, string> = {
      green: "On Track",
      yellow: "At Risk",
      red: "Off Track",
      blue: "On Hold",
    };

    const recentStatusSection =
      statuses.length > 0
        ? statuses
            .map((s) => {
              const date = s.created_at
                ? new Date(s.created_at).toLocaleDateString()
                : "";
              const color = s.color ? (statusColors[s.color] ?? s.color) : "";
              return `  [${[date, s.title, color, s.author?.name].filter(Boolean).join(" · ")}]
  ${s.text?.slice(0, 300)}${(s.text?.length ?? 0) > 300 ? "..." : ""}`;
            })
            .join("\n\n")
        : "  No status updates yet";

    const roleContext = personRole
      ? `
Tailor the brief for a **${personRole}** — focus on what's most relevant to their role and skip details they wouldn't need.`
      : "";

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Write a project onboarding brief for someone joining this project. All data is pre-fetched — do not call any additional tools.${roleContext}

## Project: ${project.name}
- **Owner:** ${project.owner?.name ?? "None"} | **Team:** ${project.team?.name ?? "None"}
- **Progress:** ${progress} complete (${completed}/${total} tasks)
- **Timeline:** ${project.start_on ? `${project.start_on} → ` : ""}${project.due_date ?? "No end date"}
- **Overdue tasks:** ${overdue.length} | **Incomplete milestones:** ${taskCounts.num_incomplete_milestones ?? 0}

## Project Description
${project.notes || "No description provided"}

## Active Team Members (${teamMembers.length})
${teamMembers.length > 0 ? teamMembers.map((n) => `  - ${n}`).join("\n") : "  No assigned members yet"}

## Project Structure (active tasks by section)
${structureSection || "  No sections with active tasks"}

## Recent Status Updates
${recentStatusSection}

---
Write a "getting up to speed" brief that covers:

1. **What this project is** — purpose, goals, and why it matters (1–2 paragraphs)
2. **Current state** — where things stand today: progress, health, any urgent issues
3. **How the work is organized** — key sections/phases and what each represents
4. **Who's involved** — team members and their apparent areas of ownership
5. **What's happening right now** — the most active and important work items
6. **Key context to know** — anything from the status updates that's critical background
7. **Suggested first steps** — 2–3 concrete things to do in the first day or two to get oriented

Write it as a document, not a list of answers. It should read like a useful internal wiki page.`,
          },
        },
      ],
    };
  },
};
