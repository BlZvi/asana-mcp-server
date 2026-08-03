# Security Policy

## Reporting a vulnerability

Report privately via [GitHub Security Advisories](https://github.com/BLZvi/asana-mcp-server/security/advisories/new). Please do not open a public issue for a security problem.

Expect an acknowledgement within a few days.

## Threat model

This server runs locally over stdio and holds an **Asana personal access token** with the full permissions of the user who issued it. The token is the primary asset.

### What the server does

- Reads `ASANA_ACCESS_TOKEN` from the environment at startup
- Talks only to `app.asana.com` over HTTPS
- Keeps an in-memory response cache for the process lifetime
- Writes nothing to disk — no logs, no cache files, no credentials

### What it deliberately does not do

- Never writes the token to disk or to any log stream
- Never sends data anywhere except the Asana API
- Never executes shell commands or reads the filesystem — the code-bridge prompts *instruct the calling client* to run git commands; this server has no repository access

## Credential handling

The Asana SDK (superagent) attaches the entire HTTP request — including the `Authorization: Bearer <token>` header — to every error object it throws. A raw `console.error(err)` therefore leaks the token into terminal scrollback, MCP client logs, and CI output.

Mitigations:

- All error logging routes through `src/lib/logging.ts`, which redacts credential patterns and emits only a status code, message, and hint
- `npm run check:logging` fails CI if any `console.*` call receives an error value
- The startup smoke test asserts the token never appears in stdout or stderr
- Unit tests cover the redaction patterns directly

If you find a path that leaks the token, treat it as a high-severity report.

## Reducing your exposure

| Measure | How |
|---|---|
| Least privilege | Issue a token from an Asana account with access only to the workspaces you need |
| Read-only | `ASANA_READ_ONLY_MODE=true` removes every write tool |
| Rehearse writes | `ASANA_DRY_RUN=true` reports intended writes without performing them |
| Rotate | Revoke and reissue tokens periodically at [Asana Developer Console](https://app.asana.com/0/my-apps) |
| Keep it out of git | Use your MCP client's env configuration; never commit the token |

## Supported versions

Only the latest published version receives security updates.

## Dependencies

`npm audit` runs in CI on every PR. Production advisories are reviewed on each run; dev-only advisories (MCP Inspector, esbuild's dev server) are reported but do not block, since they are not shipped to users.

Some remaining advisories originate from the MCP SDK's optional HTTP-transport dependencies. This server uses the stdio transport exclusively and never constructs those code paths.
