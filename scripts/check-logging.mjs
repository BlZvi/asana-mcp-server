#!/usr/bin/env node
/**
 * Guard against reintroducing the credential leak.
 *
 * The Asana SDK (superagent) attaches the entire HTTP request to every error it
 * throws, including `Authorization: Bearer <token>` — roughly 18 occurrences in
 * a single failed-request object. Passing such an error to `console.error`
 * writes the user's Asana token to stderr in plaintext, where it lands in
 * terminal scrollback, MCP client logs, and CI output.
 *
 * Rule: never pass an error value to console.*. Use `logError` from
 * `src/lib/logging.ts`, which redacts and summarises.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const ALLOWLIST = new Set(["src/lib/logging.ts"]);

/**
 * `console.<any>(..., <error-ish identifier>)`.
 *
 * String literals are blanked before matching, so punctuation inside a message
 * (e.g. `console.error("Fatal error in main():", err)`) cannot hide the
 * identifier that follows it.
 */
const UNSAFE =
  /console\.(?:error|warn|log|info|debug)\s*\([^;]*?,\s*(?:err|error|e|ex|exception|\w*Error)\s*[,)]/;

/** Replace the contents of string literals with spaces, preserving length. */
function blankStrings(line) {
  return line.replace(
    /(["'`])(?:\\.|(?!\1)[^\\])*\1/g,
    (m) => m[0] + " ".repeat(Math.max(0, m.length - 2)) + m[0],
  );
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|mts|mjs)$/.test(entry) && !/\.test\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const violations = [];
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  if (ALLOWLIST.has(rel)) continue;

  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (line.trimStart().startsWith("*") || line.trimStart().startsWith("//")) {
      return;
    }
    if (UNSAFE.test(blankStrings(line))) {
      violations.push(`${rel}:${i + 1}\n    ${line.trim()}`);
    }
  });
}

if (violations.length > 0) {
  console.error(
    `\nUnsafe error logging found (${violations.length}).\n\n` +
      `Asana SDK errors carry the bearer token. Passing one to console.* leaks\n` +
      `the user's credential into logs.\n\n` +
      `Use logError("context", err) from src/lib/logging.ts instead.\n`,
  );
  for (const v of violations) console.error(`  ${v}\n`);
  process.exit(1);
}

console.log("check:logging — no unsafe error logging found");
