import { describe, expect, it } from "vitest";
import { searchTasksWindowed, summarizeCoverage } from "./windowed-search.js";

/**
 * Asana's task search returns at most 100 results and supports NO pagination.
 * Without bisection a wide query silently truncates and reports itself as
 * complete — confidently wrong output. These tests pin that behaviour.
 */

/** Fake search returning `count` synthetic tasks, with GIDs seeded per window. */
function fakeSearch(countFor: (from: string, to: string) => number) {
  let calls = 0;
  const fn = async (opts: any) => {
    calls += 1;
    const from = opts["completed_on.after"];
    const to = opts["completed_on.before"];
    const n = countFor(from, to);
    return {
      data: Array.from({ length: n }, (_, i) => ({
        gid: `${from}-${i}`,
        name: `task ${i}`,
      })),
    };
  };
  return { fn, calls: () => calls };
}

const RANGE = {
  field: "completed_on" as const,
  from: "2026-01-01",
  to: "2026-03-31",
};

describe("searchTasksWindowed", () => {
  it("reports complete when every window is under the cap", async () => {
    const { fn } = fakeSearch(() => 12);
    const r = await searchTasksWindowed(fn, {}, RANGE);
    expect(r.coverage.complete).toBe(true);
    expect(r.coverage.saturatedBuckets).toHaveLength(0);
    expect(r.data.length).toBeGreaterThan(0);
  });

  it("bisects a saturated window instead of accepting truncated results", async () => {
    // February saturates at the month level but resolves once split.
    const { fn, calls } = fakeSearch((from) => {
      if (!from.startsWith("2026-02")) return 10;
      return from === "2026-02-01" ? 100 : 20;
    });
    const r = await searchTasksWindowed(fn, {}, RANGE);
    expect(calls()).toBeGreaterThan(3);
    expect(r.coverage.bucketsQueried).toBeGreaterThan(3);
  });

  it("marks coverage incomplete when a window stays saturated at minimum width", async () => {
    const { fn } = fakeSearch(() => 100);
    const r = await searchTasksWindowed(fn, {}, RANGE, { maxRequests: 25 });
    expect(r.coverage.complete).toBe(false);
    // Saturated results are still returned — a lower bound beats nothing.
    expect(r.data.length).toBeGreaterThan(0);
  });

  it("de-duplicates tasks appearing in overlapping windows", async () => {
    // Bucket edges intentionally overlap; dedupe by gid must clean it up.
    const fn = async () => ({
      data: [{ gid: "same" }, { gid: "same" }, { gid: "other" }],
    });
    const r = await searchTasksWindowed(fn, {}, RANGE);
    expect(r.data).toHaveLength(2);
  });

  it("stops at the request budget without throwing", async () => {
    const { fn, calls } = fakeSearch(() => 100);
    const r = await searchTasksWindowed(fn, {}, RANGE, { maxRequests: 5 });
    expect(r.coverage.budgetExhausted).toBe(true);
    expect(r.coverage.complete).toBe(false);
    expect(calls()).toBeLessThanOrEqual(5);
  });

  it("issues no requests for an inverted range", async () => {
    const { fn, calls } = fakeSearch(() => 10);
    const r = await searchTasksWindowed(
      fn,
      {},
      {
        field: "completed_on",
        from: "2026-03-31",
        to: "2026-01-01",
      },
    );
    expect(calls()).toBe(0);
    expect(r.data).toHaveLength(0);
  });

  it("propagates caller filters into every window", async () => {
    const seen: any[] = [];
    const fn = async (opts: any) => {
      seen.push(opts);
      return { data: [] };
    };
    await searchTasksWindowed(
      fn,
      { assignee_any: "u1", completed: true },
      RANGE,
    );
    expect(seen.length).toBeGreaterThan(0);
    for (const o of seen) {
      expect(o.assignee_any).toBe("u1");
      expect(o.completed).toBe(true);
    }
  });
});

describe("summarizeCoverage", () => {
  const base = {
    requestedRange: { from: "2026-01-01", to: "2026-03-31" },
    field: "completed_on" as const,
    bucketsQueried: 3,
    requestsUsed: 3,
    saturatedBuckets: [],
    complete: true,
    budgetExhausted: false,
    totalResults: 42,
  };

  it("states completeness plainly", () => {
    const s = summarizeCoverage(base);
    expect(s).toContain("42 tasks");
    expect(s).toContain("Complete");
  });

  it("warns loudly when results are a lower bound", () => {
    const s = summarizeCoverage({
      ...base,
      complete: false,
      saturatedBuckets: [{ from: "2026-02-01", to: "2026-02-15", count: 100 }],
    });
    expect(s).toMatch(/incomplete/i);
    expect(s).toMatch(/lower bound/i);
  });
});
