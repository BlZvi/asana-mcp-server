import { describe, expect, it } from "vitest";
import { errorSummary, formatError, redact } from "./logging.js";

/**
 * These tests guard a real vulnerability that shipped: the Asana SDK
 * (superagent) attaches the full HTTP request — including
 * `Authorization: Bearer <token>` — to every error it throws. Logging such an
 * error raw wrote the caller's token to stderr ~18 times per failure.
 */
describe("redact", () => {
  it("removes Asana personal access tokens", () => {
    const s = "using 1/1234567890:abcdefSECRET123 to auth";
    expect(redact(s)).not.toContain("abcdefSECRET123");
    expect(redact(s)).toContain("[REDACTED]");
  });

  it("removes Authorization headers in header-string form", () => {
    const s =
      "Authorization: Bearer 1/999:TOPSECRETVALUE\r\nHost: app.asana.com";
    const out = redact(s);
    expect(out).not.toContain("TOPSECRETVALUE");
    expect(out).toContain("Host: app.asana.com");
  });

  it("removes Authorization headers in serialised-object form", () => {
    const s = "authorization: [ 'Authorization', 'Bearer 1/999:LEAKME' ]";
    expect(redact(s)).not.toContain("LEAKME");
  });

  it("is case insensitive", () => {
    expect(redact("AUTHORIZATION: BEARER abcdef123456")).not.toContain(
      "abcdef123456",
    );
  });

  it("leaves ordinary text untouched", () => {
    const s = "Task 1234567890123 was completed by Alice";
    expect(redact(s)).toBe(s);
  });
});

describe("errorSummary", () => {
  /** Mirrors the shape superagent actually throws. */
  const superagentError = (status: number, asanaMsg?: string) => {
    const err: any = new Error(status === 401 ? "Unauthorized" : "Bad Request");
    err.status = status;
    err.response = {
      status,
      body: asanaMsg ? { errors: [{ message: asanaMsg }] } : undefined,
      headers: { "retry-after": "2" },
      req: {
        _header:
          "GET /api/1.0/tasks/1 HTTP/1.1\r\nAuthorization: Bearer 1/9:SECRETTOKEN\r\n",
      },
    };
    return err;
  };

  it("never includes the bearer token", () => {
    const summary = errorSummary(superagentError(401));
    expect(JSON.stringify(summary)).not.toContain("SECRETTOKEN");
    expect(JSON.stringify(summary)).not.toMatch(/Bearer/i);
  });

  it("extracts the status code", () => {
    expect(errorSummary(superagentError(404)).status).toBe(404);
  });

  it("surfaces Asana's own error message", () => {
    const s = errorSummary(superagentError(400, "project: Not a valid GID"));
    expect(s.asanaErrors).toEqual(["project: Not a valid GID"]);
  });

  it("adds an actionable hint for common statuses", () => {
    expect(errorSummary(superagentError(401)).hint).toMatch(/token/i);
    expect(errorSummary(superagentError(403)).hint).toMatch(/permission/i);
    expect(errorSummary(superagentError(429)).hint).toMatch(/rate limit/i);
    expect(errorSummary(superagentError(402)).hint).toMatch(/paid/i);
    expect(errorSummary(superagentError(503)).hint).toMatch(/retry/i);
  });

  it("handles non-Error values without throwing", () => {
    expect(errorSummary("plain string").message).toBe("plain string");
    expect(errorSummary(null).message).toBeDefined();
    expect(errorSummary(undefined).message).toBeDefined();
    expect(errorSummary(42).message).toBe("42");
  });

  it("redacts a token embedded in the message itself", () => {
    const e = new Error("failed with 1/1234567890:INLINESECRET");
    expect(errorSummary(e).message).not.toContain("INLINESECRET");
  });
});

describe("formatError", () => {
  it("produces a compact single line", () => {
    const err: any = new Error("Unauthorized");
    err.status = 401;
    expect(formatError(err)).toBe("HTTP 401 — Unauthorized");
  });

  it("omits the status when absent", () => {
    expect(formatError(new Error("boom"))).toBe("boom");
  });
});
