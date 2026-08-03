# MCP Server for Asana

Give your AI assistant full access to Asana. Create tasks, manage projects, analyze delivery flow, estimate work from history — all through natural language.

**86 tools** | **35 slash commands** | **Autocomplete** | **Browsable resources** | Full read + write coverage

## What can you do with this?

Just talk to your AI assistant naturally:

> "How many unfinished tasks are in Sprint 30?"

> "Create a task for Sarah to review the API docs, due Friday, in the Backend project"

> "Why is this task late?" → full lifecycle: where it stalled, who touched it, every reschedule

> "What did Alice work on in the last 3 months?"

> "How much should we commit to next sprint?" → measured from real velocity, not guesswork

> "Where does work get stuck in this project?" → cycle time, bottlenecks, throughput

> "Turn these meeting notes into tasks"

Run **`/asana-help`** to see every command grouped by what you're trying to do.

## Highlights

| | |
|---|---|
| **Type names, not GIDs** | Every command accepts a task/project *name* or *URL*. Live autocomplete suggests your real projects and people as you type. Ambiguous names return a disambiguation list rather than a wrong guess. |
| **Honest analytics** | Asana's search API caps at 100 results with no pagination. This server uses adaptive time-window bisection to get complete data — and every report states exactly what it sampled, so partial results are never mistaken for complete ones. |
| **History, not just snapshots** | Task activity streams are parsed into structured lifecycles: time-in-section, reschedule patterns, ownership churn, cycle vs. lead time. |
| **Safe by default** | Read-only mode, dry-run mode, destructive-operation hints, and preview-before-write on every bulk operation. |

## Quick Start

**1. Get your Asana token** from [Asana Developer Console](https://developers.asana.com/docs/personal-access-token)

**2. Add the server to your MCP client:**

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "asana": {
      "command": "npx",
      "args": ["-y", "@blzvi/asana-mcp-server"],
      "env": {
        "ASANA_ACCESS_TOKEN": "your-asana-access-token"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add asana -e ASANA_ACCESS_TOKEN=<TOKEN> -- npx -y @blzvi/asana-mcp-server
```

### Any MCP-compatible client

This server works with any client that supports the [Model Context Protocol](https://modelcontextprotocol.io):

```bash
ASANA_ACCESS_TOKEN=your-token npx -y @blzvi/asana-mcp-server
```

### Install from source (alternative)

```bash
git clone https://github.com/BLZvi/asana-mcp-server.git
cd asana-mcp-server
npm install
```

Then use `node build/index.js` instead of `npx -y @blzvi/asana-mcp-server` in the examples above.

## 86 Tools Across 20 Categories

Full CRUD coverage of the Asana API — your AI can read **and** write.

| Category | Tools | What you can do |
|---|:---:|---|
| **History & Flow** | 2 | Task lifecycle reconstruction, project cycle-time/bottleneck analysis |
| **Activity** | 1 | Per-person work history over any date range, with coverage reporting |
| **Estimation** | 2 | Find comparable completed tasks, compute velocity with outlier detection |
| **Code Bridge** | 1 | Resolve branch names / commit messages to Asana tasks |
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

## 35 Slash Commands

Pre-built workflows that combine API calls with AI reasoning. The server pre-fetches the relevant Asana data server-side, then hands the model one fully-hydrated message — so most commands need zero follow-up tool calls.

**Not sure which to use? Run `/asana-help`.** ✎ = writes to Asana (always previews first).

### Task-level

| Command | Description |
|---|---|
| `task-summary` | Status summary with details, custom fields, and all comments |
| `task-history` | **New.** Full lifecycle from the activity stream: time in each section, every reschedule, ownership churn, risk signals |
| `analyze-task` | Scores how well-defined a task is (0–100) with per-dimension breakdown |
| `estimate` | **New.** Estimate by anchoring on comparable completed tasks — shows their original points *and* actual cycle time |
| `task-completeness` ✎ | Identifies gaps, asks clarifying questions, updates the description |
| `task-breakdown` ✎ | Breaks a complex task into well-scoped subtasks |
| `log-work` ✎ | Retro-log work done outside Asana |

### Project-level

| Command | Description |
|---|---|
| `project-summary` | Full status report with task counts, statuses, and open tasks |
| `flow-report` | **New.** Cycle/lead time percentiles, section bottlenecks, throughput, worst offenders |
| `status-update` | Polished stakeholder update (email/Slack-ready) |
| `project-risks` | Risk register built from real risk signals |
| `stale-tasks` | **New.** Find forgotten work and decide: revive, reassign, reschedule, or close |
| `overdue-triage` | Triage overdue tasks: do now, reschedule, reassign, or drop |
| `prioritize-backlog` | Rank the backlog into P1–P4 |
| `team-workload` | Task distribution across members, to spot imbalances |
| `project-onboarding` | "Getting up to speed" brief for someone new |

### Personal productivity

| Command | Description |
|---|---|
| `my-tasks` | Prioritized daily plan from your open tasks |
| `standup` | Done / doing / blockers summary |
| `unblock-me` | **New.** What's blocking you, plus drafted nudges to clear it |
| `weekly-review` | Weekly reflection and next-week plan |
| `capture` ✎ | **New.** Turn a freeform braindump into well-formed tasks |

### Cross-project

| Command | Description |
|---|---|
| `contributions` | **New.** What a person worked on over a period, with trend comparison and methodology caveats |
| `portfolio-health` | **New.** Roll-up across every project in a portfolio — the executive view |
| `goal-progress` | **New.** Goal tracking with pace analysis (progress vs. time elapsed) |

### Planning

| Command | Description |
|---|---|
| `sprint-capacity` | **New.** How much to commit, from measured velocity — always a range |
| `sprint-planning` | Build a sprint from the backlog |
| `sprint-from-confluence` ✎ | Create tasks from a Confluence page |
| `create-task` ✎ | Guided task creation |

### Code ↔ Asana

These need your client to have git/filesystem tools (Claude Code, Cursor, etc). They degrade gracefully when it doesn't — asking you to paste the command output instead.

| Command | Description |
|---|---|
| `link-tasks-to-code` | **New.** Which tasks have code behind them, which commits have no task |
| `tech-debt-roadmap` ✎ | **New.** TODO/FIXME markers + churn hotspots → clustered, deduplicated backlog |
| `estimate-from-code` | **New.** Estimate grounded in the actual change surface |
| `release-notes` | **New.** Changelog from completed tasks + commits |
| `roadmap-gap-analysis` | **New.** Does the code back up what the roadmap claims is done? |
| `impact-analysis` | **New.** Blast radius and the right owner for a proposed change |

### Discovery

| Command | Description |
|---|---|
| `asana-help` | **New.** Every command grouped by intent, with examples and your current config |

## Browsable Resources

Expose Asana data as MCP resources that clients can browse directly:

| URI Pattern | Description |
|---|---|
| `asana://workspace/{gid}` | Workspace details, org info, email domains |
| `asana://project/{gid}` | Project details, sections, custom fields, dates |
| `asana://task/{gid}` | Task details, subtasks, custom fields, recent comments |

## Configuration

| Variable | Default | Description |
|---|---|---|
| `ASANA_ACCESS_TOKEN` | **required** | Your [Asana personal access token](https://developers.asana.com/docs/personal-access-token) |
| `ASANA_DEFAULT_WORKSPACE_GID` | — | Default workspace — avoids passing one to every command |
| `ASANA_READ_ONLY_MODE` | `false` | `true` disables and hides all write operations |
| `ASANA_DRY_RUN` | `false` | `true` keeps write tools visible but reports what they *would* do without calling Asana |
| `ASANA_TIMEZONE` | `UTC` | IANA timezone for all "today"/overdue reasoning (e.g. `America/New_York`) |
| `ASANA_MAX_CONCURRENCY` | `4` | Simultaneous Asana API calls (1–10) |
| `ASANA_MAX_REQUESTS_PER_PROMPT` | `80` | Request budget per analytics command (10–500) |
| `ASANA_CACHE_DISABLED` | `false` | `true` bypasses all response caching |
| `ASANA_POINTS_FIELD_GID` | — | Explicit story-points custom field GID |
| `ASANA_POINTS_FIELD_NAME` | `^(story )?points?$\|^estimate$\|^size$` | Regex used to auto-discover the points field |
| `ASANA_SPRINT_LENGTH_DAYS` | `14` | Default period length for velocity |
| `ASANA_BUSINESS_DAYS` | `1,2,3,4,5` | Working days (0 = Sunday) |

Bad or missing config never throws — every value degrades to its default.

> **Set `ASANA_TIMEZONE`.** The default of UTC means a user in UTC-8 at 5pm gets tomorrow's date, and tasks get flagged overdue a day early.

## Safety Modes

**Read-only** (`ASANA_READ_ONLY_MODE=true`) — hides all 43 write tools and 7 write commands. For safe exploration, shared environments, and audit/reporting use.

**Dry run** (`ASANA_DRY_RUN=true`) — write tools stay *visible* so the model can plan a complete sequence, but each returns `"would have created task X"` instead of calling Asana. Use this to rehearse a bulk operation before committing to it.

**Tool annotations** — every tool reports `readOnlyHint`, `destructiveHint`, and `idempotentHint`, so clients can auto-approve safe reads while prompting for confirmation on the 13 genuinely destructive operations.

## How the analytics stay honest

Asana's task search endpoint returns at most 100 results and **supports no pagination**. A naive "what did Alice do in 6 months" query returns an arbitrary 100 tasks and reports it as complete.

This server solves that with **adaptive time-window bisection**: the range is split into buckets, and any bucket that saturates at 100 is recursively halved until it fits or hits a floor. Results are deduplicated by GID.

Critically, every command using this reports its own coverage:

> *Based on 340 tasks across 7 windows (28 requests). Complete.*

or

> *Based on 512 tasks across 12 windows (40 requests). **INCOMPLETE** — 2 windows hit the 100-result cap; counts are a lower bound.*

The same principle applies throughout: `flow-report` states its sample size versus project size, `contributions` ships methodology caveats with the data, and `sprint-capacity` suppresses point velocity entirely when fewer than 50% of tasks have points set — because low-coverage point velocity looks authoritative while measuring an arbitrary subset.

## Roadmap

What's coming next:

- **Elicitation** — Structured confirmation dialogs for bulk writes (currently prose-based preview + confirm)
- **Structured output** — `outputSchema` on read tools so clients render tables instead of JSON
- **Remove dependencies/dependents** — Complete dependency management (currently add-only)
- **Story CRUD** — Edit and delete comments (currently read + create)
- **Duplicate project** — Create projects from templates
- **Test coverage** — Unit and integration tests with vitest

## Full Tool Reference

<details>
<summary><strong>History, Flow & Analytics</strong> — 6 tools</summary>

| Tool | Description |
|---|---|
| `asana_get_task_history` | Reconstruct a task's full lifecycle from its activity stream: event timeline, time per section, cycle/lead time, reschedule history with slip days, ownership churn, and triggered risk signals |
| `asana_get_project_flow_metrics` | Cycle/lead time percentiles, section bottlenecks, weekly throughput, reschedule rates, and worst-offending tasks for a project |
| `asana_get_user_activity` | What a person completed and created over a date range, aggregated by month and project, with full coverage reporting and methodology caveats |
| `asana_find_comparable_tasks` | Find completed tasks similar to a target, returning their estimates **and** actual cycle times for reference-class forecasting |
| `asana_get_velocity` | Velocity for a person or project using median + MAD, with bulk-close outlier detection and points-coverage reporting |
| `asana_match_tasks_to_refs` | Resolve branch names, commit messages, and PR titles to Asana tasks |

</details>

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
