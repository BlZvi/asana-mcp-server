import { describe, expect, it } from "vitest";
import { computeLifecycle, computeSignals } from "./lifecycle.js";
import { parseStories } from "./story-parser.js";

const story = (
  subtype: string,
  at: string,
  extra: Record<string, any> = {},
) => ({
  gid: `${Math.round(Math.random() * 1e9)}`,
  resource_subtype: subtype,
  created_at: at,
  created_by: { gid: "u1", name: "Alice" },
  ...extra,
});

const sectionMove = (at: string, from: string, to: string) =>
  story("section_changed", at, {
    old_section: { name: from },
    new_section: { name: to },
  });

describe("parseStories", () => {
  it("maps known subtypes to event kinds", () => {
    const events = parseStories([
      sectionMove("2026-01-05T00:00:00Z", "Backlog", "Doing"),
      story("assigned", "2026-01-05T01:00:00Z", {
        assignee: { gid: "u2", name: "Bob" },
      }),
      story("due_date_changed", "2026-01-06T00:00:00Z", {
        old_dates: { due_on: "2026-01-20" },
        new_dates: { due_on: "2026-01-27" },
      }),
      story("marked_complete", "2026-01-07T00:00:00Z"),
      story("comment_added", "2026-01-08T00:00:00Z", { text: "looks good" }),
    ]);
    expect(events.map((e) => e.kind)).toEqual([
      "section",
      "assignment",
      "reschedule",
      "completion",
      "comment",
    ]);
  });

  /** Asana adds new subtypes over time; an unknown one must never throw. */
  it("degrades unknown subtypes to 'other' and preserves the raw value", () => {
    const events = parseStories([
      story("some_future_asana_subtype", "2026-01-01T00:00:00Z"),
    ]);
    expect(events[0].kind).toBe("other");
    expect(events[0].raw).toBe("some_future_asana_subtype");
  });

  it("tolerates missing nested fields", () => {
    expect(() =>
      parseStories([
        {
          gid: "1",
          resource_subtype: "section_changed",
          created_at: "2026-01-01T00:00:00Z",
        },
        { gid: "2" },
        {},
      ]),
    ).not.toThrow();
  });

  it("sorts events chronologically", () => {
    const events = parseStories([
      story("marked_complete", "2026-01-09T00:00:00Z"),
      story("assigned", "2026-01-02T00:00:00Z"),
    ]);
    expect(events[0].at < events[1].at).toBe(true);
  });
});

describe("computeLifecycle", () => {
  it("counts repeat visits to the same section", () => {
    const events = parseStories([
      sectionMove("2026-01-05T00:00:00Z", "Backlog", "Doing"),
      sectionMove("2026-01-10T00:00:00Z", "Doing", "Review"),
      sectionMove("2026-01-12T00:00:00Z", "Review", "Doing"),
      sectionMove("2026-01-15T00:00:00Z", "Doing", "Review"),
    ]);
    const lc = computeLifecycle(
      events,
      { created_at: "2026-01-01T00:00:00Z", completed: false },
      { now: "2026-01-20" },
    );
    expect(lc.sectionTotals.Review.visits).toBe(2);
    expect(lc.sectionTotals.Doing.visits).toBe(2);
  });

  it("uses the LAST completion when a task is reopened", () => {
    const events = parseStories([
      story("assigned", "2026-01-05T00:00:00Z", {
        assignee: { gid: "u1", name: "A" },
      }),
      story("marked_complete", "2026-01-18T00:00:00Z"),
      story("marked_incomplete", "2026-01-19T00:00:00Z"),
      story("marked_complete", "2026-01-22T00:00:00Z"),
    ]);
    const lc = computeLifecycle(
      events,
      {
        created_at: "2026-01-01T00:00:00Z",
        completed_at: "2026-01-22T00:00:00Z",
        completed: true,
      },
      { now: "2026-02-01" },
    );
    expect(lc.leadTimeDays).toBe(21);
    expect(lc.cycleTimeDays).toBe(17);
  });

  it("produces contiguous intervals summing to the task age", () => {
    const events = parseStories([
      sectionMove("2026-01-05T00:00:00Z", "Backlog", "Doing"),
      sectionMove("2026-01-10T00:00:00Z", "Doing", "Review"),
    ]);
    const lc = computeLifecycle(
      events,
      {
        created_at: "2026-01-01T00:00:00Z",
        completed_at: "2026-01-22T00:00:00Z",
        completed: true,
      },
      { now: "2026-02-01" },
    );
    const contiguous = lc.sectionIntervals.every(
      (iv, i, arr) => i === 0 || arr[i - 1].exitedAt === iv.enteredAt,
    );
    expect(contiguous).toBe(true);
    const total = Object.values(lc.sectionTotals).reduce(
      (a, b) => a + b.days,
      0,
    );
    expect(total).toBeCloseTo(21, 0);
  });

  it("synthesises one interval when there are no section events", () => {
    const lc = computeLifecycle(
      [],
      { created_at: "2026-01-01T00:00:00Z", completed: false },
      { now: "2026-01-10", currentSection: "Backlog" },
    );
    expect(lc.sectionIntervals).toHaveLength(1);
    expect(lc.sectionIntervals[0].section).toBe("Backlog");
    expect(lc.cycleTimeDays).toBeNull();
    expect(lc.idleDays).toBe(9);
  });

  it("starts the first interval at added_to_project, not creation", () => {
    const events = parseStories([
      story("added_to_project", "2026-01-06T00:00:00Z"),
      sectionMove("2026-01-08T00:00:00Z", "Backlog", "Doing"),
    ]);
    const lc = computeLifecycle(
      events,
      { created_at: "2026-01-01T00:00:00Z", completed: false },
      { now: "2026-01-20" },
    );
    expect(lc.sectionIntervals[0].enteredAt).toBe("2026-01-06T00:00:00Z");
  });

  it("records reschedules with signed slip days", () => {
    const events = parseStories([
      story("due_date_changed", "2026-01-11T00:00:00Z", {
        old_dates: { due_on: "2026-01-20" },
        new_dates: { due_on: "2026-01-27" },
      }),
      story("due_date_changed", "2026-01-14T00:00:00Z", {
        old_dates: { due_on: "2026-01-27" },
        new_dates: { due_on: "2026-02-03" },
      }),
    ]);
    const lc = computeLifecycle(
      events,
      { created_at: "2026-01-01T00:00:00Z", completed: false },
      { now: "2026-01-20" },
    );
    expect(lc.rescheduleCount).toBe(2);
    expect(lc.reschedulePattern.map((r) => r.slipDays)).toEqual([7, 7]);
  });

  it("returns a valid shape for an empty event list", () => {
    const lc = computeLifecycle([], {}, { now: "2026-01-10" });
    expect(lc.sectionIntervals).toBeDefined();
    expect(lc.rescheduleCount).toBe(0);
    expect(lc.participants).toEqual([]);
  });
});

describe("computeSignals", () => {
  it("flags a review-bound task", () => {
    const events = parseStories([
      sectionMove("2026-01-05T00:00:00Z", "Backlog", "Doing"),
      sectionMove("2026-01-08T00:00:00Z", "Doing", "Review"),
    ]);
    const lc = computeLifecycle(
      events,
      {
        created_at: "2026-01-01T00:00:00Z",
        completed_at: "2026-01-22T00:00:00Z",
        completed: true,
      },
      { now: "2026-02-01" },
    );
    expect(computeSignals(lc).reviewBound).not.toBeNull();
  });

  it("flags chronic slip once the threshold is crossed", () => {
    const events = parseStories(
      [
        ["2026-01-11T00:00:00Z", "2026-01-20", "2026-01-27"],
        ["2026-01-14T00:00:00Z", "2026-01-27", "2026-02-03"],
        ["2026-01-18T00:00:00Z", "2026-02-03", "2026-02-10"],
      ].map(([at, from, to]) =>
        story("due_date_changed", at, {
          old_dates: { due_on: from },
          new_dates: { due_on: to },
        }),
      ),
    );
    const lc = computeLifecycle(
      events,
      { created_at: "2026-01-01T00:00:00Z", completed: false },
      { now: "2026-01-20" },
    );
    const signals = computeSignals(lc);
    expect(signals.chronicSlip?.rescheduleCount).toBe(3);
    expect(signals.chronicSlip?.totalSlipDays).toBe(21);
  });

  it("returns all-null signals for a healthy task", () => {
    const lc = computeLifecycle(
      parseStories([sectionMove("2026-01-05T00:00:00Z", "Backlog", "Doing")]),
      {
        created_at: "2026-01-04T00:00:00Z",
        completed_at: "2026-01-06T00:00:00Z",
        completed: true,
      },
      { now: "2026-01-06" },
    );
    const s = computeSignals(lc);
    expect(s.chronicSlip).toBeNull();
    expect(s.ownershipChurn).toBeNull();
    expect(s.stalled).toBeNull();
  });
});
