#!/usr/bin/env node
/**
 * Startup smoke test — runs the built server over stdio with a fake token and
 * asserts it completes the MCP handshake and serves its full catalog.
 *
 * Catches the class of failure unit tests cannot: a broken import, a duplicate
 * tool name, a malformed zod schema, or a registration-time throw. All of these
 * compile fine and only fail when the server actually boots.
 */
import { spawn } from "node:child_process";

const FAKE_TOKEN = "1/1234567890:SMOKETESTSECRETVALUE";
const TIMEOUT_MS = 20_000;

function rpc(server, msg) {
  server.stdin.write(`${JSON.stringify(msg)}\n`);
}

const failures = [];
const check = (label, cond, detail = "") => {
  if (cond) {
    console.log(`  ok    ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures.push(label);
  }
};

async function probe({ label, env, expect }) {
  console.log(`\n[${label}]`);
  const server = spawn("node", ["build/index.js"], {
    env: { ...process.env, ASANA_ACCESS_TOKEN: FAKE_TOKEN, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  server.stdout.on("data", (d) => (stdout += d));
  server.stderr.on("data", (d) => (stderr += d));

  /**
   * Wait for a specific response id rather than sleeping a fixed interval.
   * Startup cost varies with dependency versions and CI load, so a fixed delay
   * produces flaky failures that look like real breakage.
   */
  const waitForId = (id, ms = 15_000) =>
    new Promise((resolve) => {
      const deadline = Date.now() + ms;
      const poll = setInterval(() => {
        const hit = stdout
          .split("\n")
          .filter(Boolean)
          .some((l) => {
            try {
              return JSON.parse(l).id === id;
            } catch {
              return false;
            }
          });
        if (hit || Date.now() > deadline) {
          clearInterval(poll);
          resolve(hit);
        }
      }, 50);
    });

  rpc(server, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "smoke", version: "1" },
    },
  });

  await waitForId(1);
  rpc(server, { jsonrpc: "2.0", method: "notifications/initialized" });
  rpc(server, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  rpc(server, { jsonrpc: "2.0", id: 3, method: "prompts/list" });

  await waitForId(2);
  await waitForId(3);
  server.kill();

  const messages = stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const init = messages.find((m) => m.id === 1);
  const tools = messages.find((m) => m.id === 2)?.result?.tools ?? [];
  const prompts = messages.find((m) => m.id === 3)?.result?.prompts ?? [];

  check("completes the MCP handshake", Boolean(init?.result?.serverInfo));
  check(
    "advertises the completions capability",
    Boolean(init?.result?.capabilities?.completions),
  );
  check(
    `serves >= ${expect.minTools} tools`,
    tools.length >= expect.minTools,
    `got ${tools.length}`,
  );
  check(
    `serves >= ${expect.minPrompts} prompts`,
    prompts.length >= expect.minPrompts,
    `got ${prompts.length}`,
  );
  check(
    "every tool has a title and annotations",
    tools.length > 0 &&
      tools.every(
        (t) => t.title && typeof t.annotations?.readOnlyHint === "boolean",
      ),
  );
  check(
    "every prompt has a title",
    prompts.length > 0 && prompts.every((p) => p.title),
  );

  const names = tools.map((t) => t.name);
  check("no duplicate tool names", new Set(names).size === names.length);

  const promptNames = prompts.map((p) => p.name);
  check(
    "no duplicate prompt names",
    new Set(promptNames).size === promptNames.length,
  );

  // The reason this whole script exists: a bearer token must never reach logs.
  const combined = stdout + stderr;
  check(
    "token never appears in stdout or stderr",
    !combined.includes("SMOKETESTSECRETVALUE"),
  );
  check("no Authorization header in output", !/Bearer\s+\S/.test(combined));

  if (expect.writeToolsHidden) {
    check(
      "write tools are hidden in read-only mode",
      tools.every((t) => t.annotations?.readOnlyHint === true),
    );
  }

  if (failures.length > 0 && stderr) {
    console.log("\n--- stderr ---\n" + stderr.slice(0, 1500));
  }
}

const timer = setTimeout(() => {
  console.error("\nSmoke test timed out.");
  process.exit(1);
}, TIMEOUT_MS);

await probe({
  label: "default",
  env: {},
  expect: { minTools: 80, minPrompts: 30 },
});

await probe({
  label: "read-only",
  env: { ASANA_READ_ONLY_MODE: "true" },
  expect: { minTools: 40, minPrompts: 25, writeToolsHidden: true },
});

clearTimeout(timer);

if (failures.length > 0) {
  console.error(`\nSmoke test FAILED (${failures.length} check(s)).`);
  process.exit(1);
}
console.log("\nSmoke test passed.");
