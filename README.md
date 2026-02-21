# MCP Server for Asana

Give your AI assistant full access to Asana. Create tasks, manage projects, track time, search across your workspace — all through natural language.

**80 tools** | **18 prompt templates** | **Browsable resources** | Full read + write coverage

## What can you do with this?

Just talk to your AI assistant naturally:

> "How many unfinished tasks are in Sprint 30?"

> "Create a task for Sarah to review the API docs, due Friday, in the Backend project"

> "Move all overdue tasks in the Marketing project to the Backlog section"

> "Log 2 hours on PROJ-1234 for today"

> "What's the status of our Q1 goals?"

> "Give me a standup summary for today"

> "Break down this task into subtasks"

## Quick Start

**1. Get your Asana token** from [Asana Developer Console](https://developers.asana.com/docs/personal-access-token)

**2. Clone and build:**

```bash
git clone https://github.com/BLZvi/asana-mcp-server.git
cd asana-mcp-server
npm install
```

**3. Add the server to your MCP client:**

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "asana": {
      "command": "node",
      "args": ["/absolute/path/to/asana-mcp-server/build/index.js"],
      "env": {
        "ASANA_ACCESS_TOKEN": "your-asana-access-token"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add asana -e ASANA_ACCESS_TOKEN=<TOKEN> -- node /absolute/path/to/asana-mcp-server/build/index.js
```

### Any MCP-compatible client

This server works with any client that supports the [Model Context Protocol](https://modelcontextprotocol.io) — point it at the built `build/index.js` with the `ASANA_ACCESS_TOKEN` env var.

## 80 Tools Across 16 Categories

Full CRUD coverage of the Asana API — your AI can read **and** write.

| Category | Tools | What you can do |
|---|:---:|---|
| **Tasks** | 12 | Search, create, update, delete, list by project/section/tag, batch get (up to 25), subtasks, multi-project |
| **Task Relationships** | 3 | Dependencies, dependents, reparenting |
| **Projects** | 7 | Search by name, CRUD, get sections & task counts |
| **Project Statuses** | 4 | CRUD for project status updates |
| **Sections** | 6 | CRUD, reorder, move tasks between sections |
| **Tags** | 9 | CRUD, add/remove from tasks, list by workspace/task |
| **Custom Fields** | 7 | Create/manage field definitions and enum options |
| **Portfolios** | 8 | CRUD, add/remove projects from portfolios |
| **Goals** | 5 | CRUD for workspace goals |
| **Time Tracking** | 7 | Log hours, manage entries, browse time periods |
| **Comments & Stories** | 2 | Read activity feed, post comments (plain or rich HTML) |
| **Attachments** | 4 | List, inspect, delete, attach external URLs |
| **Users** | 2 | Look up users by GID, email, or `me` |
| **Teams** | 2 | Get team info, list teams in workspace |
| **Typeahead** | 1 | Fuzzy search any resource type by name |
| **Workspaces** | 1 | List all accessible workspaces |

## 18 Prompt Templates

Pre-built workflows that combine API calls with AI reasoning. The AI pre-fetches relevant Asana data, then produces structured analysis or takes action.

### Task-level

| Prompt | Description |
|---|---|
| `task-summary` | Pre-fetches task details + comments, generates a status summary |
| `analyze-task` | Scores how well-defined a task is (0-100) with per-dimension breakdown |
| `task-completeness` | Fetches a task, identifies gaps, asks clarifying questions, updates the description |
| `task-breakdown` | Breaks a complex task into well-scoped subtasks |
| `log-work` | Retro-log work done outside Asana — creates a task and marks it complete |

### Project-level

| Prompt | Description |
|---|---|
| `project-summary` | Full project status report with task counts, statuses, and open tasks |
| `status-update` | Polished stakeholder status update (email/Slack-ready) |
| `project-risks` | Scans for risk signals (overdue, unassigned, empty descriptions) and produces a risk register |
| `project-onboarding` | "Getting up to speed" brief for someone new to a project |
| `overdue-triage` | Triages overdue tasks: do now, reschedule, reassign, or drop |
| `prioritize-backlog` | Guides prioritization of incomplete tasks by section |
| `team-workload` | Analyzes task distribution across team members to spot imbalances |

### Personal productivity

| Prompt | Description |
|---|---|
| `my-tasks` | Fetches your incomplete tasks and generates a prioritized daily plan |
| `standup` | Done/doing/blockers summary from your recent task activity |
| `weekly-review` | Weekly reflection + plan from completed and open tasks |

### Planning & creation

| Prompt | Description |
|---|---|
| `sprint-planning` | Plans a sprint from a project's backlog based on team capacity |
| `sprint-from-confluence` | Fetches a Confluence page and creates corresponding Asana tasks |
| `create-task` | Guided task creation with clarifying questions |

## Browsable Resources

Expose Asana data as MCP resources that clients can browse directly:

| URI Pattern | Description |
|---|---|
| `asana://workspace/{gid}` | Workspace details, org info, email domains |
| `asana://project/{gid}` | Project details, sections, custom fields, dates |
| `asana://task/{gid}` | Task details, subtasks, custom fields, recent comments |

## Configuration

| Variable | Required | Description |
|---|---|---|
| `ASANA_ACCESS_TOKEN` | Yes | Your [Asana personal access token](https://developers.asana.com/docs/personal-access-token) |
| `ASANA_DEFAULT_WORKSPACE_GID` | No | Default workspace GID — tools use this when no workspace is specified |
| `ASANA_READ_ONLY_MODE` | No | Set to `true` to disable all write operations (great for safe exploration) |

## Read-Only Mode

Set `ASANA_READ_ONLY_MODE=true` to restrict the server to read-only operations. All create/update/delete tools and write prompts are automatically hidden. Useful for:

- Safely exploring what the server can do before granting write access
- Shared environments where you want to prevent accidental changes
- Audit and reporting use cases

## Roadmap

What's coming next:

- **Rate limiting / retry** — Automatic backoff for Asana's 429 rate limits
- **Remove dependencies/dependents** — Complete dependency management (currently add-only)
- **Story CRUD** — Edit and delete comments (currently read + create)
- **Duplicate project** — Create projects from templates
- **Test coverage** — Unit and integration tests with vitest

See [roadmap.md](roadmap.md) for the full plan.

## Full Tool Reference

<details>
<summary><strong>Tasks</strong> — 12 tools</summary>

| Tool | Description |
|---|---|
| `asana_search_tasks` | Search tasks with advanced filtering (assignee, project, tags, custom fields, etc.) |
| `asana_get_task` | Get detailed information about a task |
| `asana_get_multiple_tasks_by_gid` | Get details for up to 25 tasks at once |
| `asana_create_task` | Create a task in a project (supports section placement via `memberships`) |
| `asana_update_task` | Update task details (name, assignee, due date, custom fields, etc.) |
| `asana_delete_task` | Permanently delete a task |
| `asana_get_tasks_for_project` | List all tasks in a project |
| `asana_get_tasks_for_section` | List all tasks in a section |
| `asana_create_subtask` | Create a subtask under a parent task |
| `asana_get_subtasks` | Get all subtasks of a task |
| `asana_add_project_to_task` | Add a task to a project |
| `asana_remove_project_from_task` | Remove a task from a project |

</details>

<details>
<summary><strong>Task Relationships</strong> — 3 tools</summary>

| Tool | Description |
|---|---|
| `asana_add_task_dependencies` | Set tasks that a task depends on |
| `asana_add_task_dependents` | Set tasks that depend on a task |
| `asana_set_parent_for_task` | Set/change a task's parent and position |

</details>

<details>
<summary><strong>Projects</strong> — 7 tools</summary>

| Tool | Description |
|---|---|
| `asana_search_projects` | Search projects by name pattern |
| `asana_get_project` | Get project details |
| `asana_create_project` | Create a new project |
| `asana_update_project` | Update project details |
| `asana_delete_project` | Delete a project |
| `asana_get_project_task_counts` | Get task count breakdown for a project |
| `asana_get_project_sections` | Get sections in a project |

</details>

<details>
<summary><strong>Project Statuses</strong> — 4 tools</summary>

| Tool | Description |
|---|---|
| `asana_get_project_statuses` | Get all status updates for a project |
| `asana_get_project_status` | Get a specific project status |
| `asana_create_project_status` | Create a project status update |
| `asana_delete_project_status` | Delete a project status update |

</details>

<details>
<summary><strong>Sections</strong> — 6 tools</summary>

| Tool | Description |
|---|---|
| `asana_get_section` | Get section details |
| `asana_create_section` | Create a section in a project |
| `asana_update_section` | Rename a section |
| `asana_delete_section` | Delete a section |
| `asana_move_section` | Reorder a section within a project |
| `asana_add_task_to_section` | Move a task to a section |

</details>

<details>
<summary><strong>Tags</strong> — 9 tools</summary>

| Tool | Description |
|---|---|
| `asana_get_tag` | Get tag details |
| `asana_get_tags_for_task` | Get tags on a task |
| `asana_get_tasks_for_tag` | Get tasks with a specific tag |
| `asana_get_tags_for_workspace` | List tags in a workspace |
| `asana_create_tag_for_workspace` | Create a new tag |
| `asana_update_tag` | Update a tag |
| `asana_delete_tag` | Delete a tag |
| `asana_add_tag_to_task` | Add a tag to a task |
| `asana_remove_tag_from_task` | Remove a tag from a task |

</details>

<details>
<summary><strong>Custom Fields</strong> — 7 tools</summary>

| Tool | Description |
|---|---|
| `asana_get_custom_fields_for_workspace` | List all custom field definitions in a workspace |
| `asana_get_custom_field` | Get custom field details (including enum options and GIDs) |
| `asana_create_custom_field` | Create a new custom field (text, number, enum, date, people) |
| `asana_update_custom_field` | Update custom field name, description, or number settings |
| `asana_delete_custom_field` | Permanently delete a custom field from the workspace |
| `asana_create_enum_option` | Add a new option to an enum or multi_enum custom field |
| `asana_update_enum_option` | Update an enum option's name, color, or enabled status |

</details>

<details>
<summary><strong>Portfolios</strong> — 8 tools</summary>

| Tool | Description |
|---|---|
| `asana_get_portfolio` | Get portfolio details |
| `asana_get_portfolios` | List portfolios in a workspace |
| `asana_create_portfolio` | Create a portfolio |
| `asana_update_portfolio` | Update a portfolio |
| `asana_delete_portfolio` | Delete a portfolio |
| `asana_get_portfolio_items` | Get projects in a portfolio |
| `asana_add_portfolio_item` | Add a project to a portfolio |
| `asana_remove_portfolio_item` | Remove a project from a portfolio |

</details>

<details>
<summary><strong>Goals</strong> — 5 tools</summary>

| Tool | Description |
|---|---|
| `asana_get_goal` | Get goal details |
| `asana_get_goals` | List goals in a workspace |
| `asana_create_goal` | Create a goal |
| `asana_update_goal` | Update a goal |
| `asana_delete_goal` | Delete a goal |

</details>

<details>
<summary><strong>Time Tracking & Periods</strong> — 7 tools</summary>

| Tool | Description |
|---|---|
| `asana_get_time_periods` | List time periods in a workspace (quarters, fiscal years) |
| `asana_get_time_period` | Get time period details |
| `asana_get_time_tracking_entries` | Get time entries for a task |
| `asana_get_time_tracking_entry` | Get a specific time entry |
| `asana_create_time_tracking_entry` | Log time on a task |
| `asana_update_time_tracking_entry` | Update a time entry |
| `asana_delete_time_tracking_entry` | Delete a time entry |

</details>

<details>
<summary><strong>Comments & Stories</strong> — 2 tools</summary>

| Tool | Description |
|---|---|
| `asana_get_task_stories` | Get comments and activity for a task |
| `asana_create_task_story` | Add a comment to a task (plain text or rich HTML) |

</details>

<details>
<summary><strong>Attachments</strong> — 4 tools</summary>

| Tool | Description |
|---|---|
| `asana_get_attachments_for_object` | List all attachments on a task or project |
| `asana_get_attachment` | Get attachment details (including download URL) |
| `asana_delete_attachment` | Delete an attachment |
| `asana_create_attachment_for_object` | Attach an external URL link to a task or project |

</details>

<details>
<summary><strong>Users</strong> — 2 tools</summary>

| Tool | Description |
|---|---|
| `asana_get_user` | Get user details by GID, email, or `'me'` (current user) |
| `asana_get_users_for_workspace` | List all users in a workspace (find GIDs by name or email) |

</details>

<details>
<summary><strong>Teams</strong> — 2 tools</summary>

| Tool | Description |
|---|---|
| `asana_get_team` | Get team details |
| `asana_get_teams_for_workspace` | List all teams in a workspace |

</details>

<details>
<summary><strong>Typeahead</strong> — 1 tool</summary>

| Tool | Description |
|---|---|
| `asana_typeahead` | Fuzzy-search for tasks, projects, users, tags, teams, portfolios, or goals by partial name |

</details>

<details>
<summary><strong>Workspaces</strong> — 1 tool</summary>

| Tool | Description |
|---|---|
| `asana_list_workspaces` | List all available workspaces |

</details>

## Requirements

- **Node.js 22+**
- An [Asana personal access token](https://developers.asana.com/docs/personal-access-token)

## Contributing

```bash
git clone https://github.com/BLZvi/asana-mcp-server.git
cd asana-mcp-server
npm install
npm run dev
```

Test with the MCP Inspector:

```bash
npm run inspector
```

## License

MIT
