# Contributing

## Setup

Requires Node 22+. CI runs against 22 (Maintenance LTS), 24 (Active LTS), and 26 (Current); develop on 24 unless you are specifically chasing a version-specific bug.

```bash
git clone https://github.com/BLZvi/asana-mcp-server.git
cd asana-mcp-server
npm install
```

## The one command that matters

```bash
npm run verify
```

This runs exactly what CI runs — lint, typecheck, tests, the logging guard, build, and a startup smoke test. If it passes locally, CI will pass.

| Script | Purpose |
|---|---|
| `npm run verify` | Everything CI runs |
| `npm test` / `npm run test:watch` | Unit tests |
| `npm run test:coverage` | Coverage report for `src/lib/` |
| `npm run typecheck` | `tsc --noEmit` over source *and* tests |
| `npm run lint:fix` | Auto-fix formatting and lint |
| `npm run smoke` | Boot the built server and assert it serves its catalog |
| `npm run check:logging` | Guard against credential leaks in logs |
| `npm run dev` / `npm run watch` | Run from source with tsx |
| `npm run inspector` | Interactive testing via MCP Inspector |

## Non-negotiable rules

### 1. Never log a raw error

The Asana SDK (superagent) attaches the whole HTTP request to every error it throws — including `Authorization: Bearer <token>`, roughly 18 times per error object. `console.error("failed:", err)` therefore writes the user's Asana token to stderr in plaintext.

```ts
// NO — leaks the bearer token
console.error("Error fetching task:", err);

// YES — redacted, summarised, with an actionable hint
import { logError } from "./lib/logging.js";
logError("Error fetching task", err);
```

`npm run check:logging` enforces this and fails CI.

### 2. Never let analytics lie about coverage

Asana's task search returns at most 100 results and **supports no pagination**. Any query that could exceed 100 must go through `searchTasksWindowed`, and the result's `coverage` must be surfaced to the user.

```ts
const { data, coverage } = await client.searchTasksWindowed(ws, opts, range);
// summarizeCoverage(coverage) MUST appear in the output
```

A confidently wrong number is worse than an admitted gap.

### 3. Never parse story text

Story `text` is localized and changes without notice. Use `resource_subtype` plus the structured `old_*`/`new_*` fields via `parseStories`.

```ts
// NO — breaks on non-English workspaces and Asana copy changes
if (story.text.includes("changed the due date")) { ... }

// YES
const events = parseStories(stories);
events.filter((e) => e.kind === "reschedule");
```

### 4. Preview before writing

Any prompt that creates or modifies data must present a preview and get explicit confirmation first. Test write paths with `ASANA_DRY_RUN=true`.

## Adding a tool

1. Create or extend a file in `src/tools/`, exporting a `ToolEntry[]`.
2. Give every zod field a `.describe()` — the model relies on these.
3. Set `readOnly` accurately. Add `destructive: true` for anything irreversible.
4. Register the array in `src/tool-handler.ts`.
5. Run `npm run verify` (the smoke test catches duplicate names and bad schemas).

## Adding a prompt

1. Create a file in `src/prompts/`, exporting a `PromptEntry`.
2. **Pre-fetch the data server-side** and return one fully-hydrated message. Do not make the model issue a chain of tool calls.
3. Accept names and URLs, not just GIDs — use the resolvers in `src/lib/resolve.ts`.
4. Handle the empty case explicitly. A friendly "nothing found" beats a wall of "None".
5. Include `permalink_url` in every rendered task so output is clickable.
6. Register it in `src/prompt-handler.ts`. If it takes a task/project/user argument, add the argument name to `ARG_COMPLETIONS` so it gets autocomplete.

## Testing

Tests live beside their subject as `*.test.ts` and run under vitest.

Priority for coverage is pure logic in `src/lib/` — `story-parser`, `lifecycle`, `windowed-search`, `resolve`, `logging`. These are deterministic and are where silent correctness bugs hide. Tool and prompt handlers are thin wrappers; the smoke test covers their registration.

Do not write tests that call the live Asana API.

## Commits and PRs

Short imperative subject lines (`Add velocity outlier detection`, `Fix token leak in error logs`). Explain *why* in the body when it isn't obvious.

Before opening a PR, run `npm run verify` and note any user-visible change in the PR description.
