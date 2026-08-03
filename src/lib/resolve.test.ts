import { describe, expect, it } from "vitest";
import { extractGid, extractProjectGid } from "./resolve.js";

/**
 * The original code used `input.split("/").pop()`, which silently broke on URLs
 * carrying a query string and on Asana's newer /1/<ws>/project/.../task/<gid>
 * format. These cases lock the correct behaviour in.
 */
describe("extractGid", () => {
  const cases: [string, string | null, string][] = [
    ["1234567890123", "1234567890123", "bare GID"],
    [
      "https://app.asana.com/0/1200000000/1234567890123",
      "1234567890123",
      "classic task URL",
    ],
    [
      "https://app.asana.com/0/1200000000/1234567890123?focus=true",
      "1234567890123",
      "URL with query string",
    ],
    [
      "https://app.asana.com/0/1200000000/1234567890123#comment",
      "1234567890123",
      "URL with fragment",
    ],
    [
      "https://app.asana.com/1/99/project/1200000000/task/1234567890123",
      "1234567890123",
      "modern task URL",
    ],
    [
      "https://app.asana.com/0/1200000000/1234567890123/f",
      "1234567890123",
      "URL with trailing /f",
    ],
    [
      "Fix login bug (1234567890123)",
      "1234567890123",
      "autocomplete 'Name (gid)' form",
    ],
    ["just a task name", null, "plain text"],
    ["", null, "empty string"],
    ["12345", null, "too short to be a GID"],
  ];

  for (const [input, expected, label] of cases) {
    it(`handles ${label}`, () => {
      expect(extractGid(input)).toBe(expected);
    });
  }

  it("does not return a project GID when asked for a task", () => {
    // Returning the project id here would surface later as a confusing 404.
    expect(extractGid("https://app.asana.com/0/1200000000/list")).toBeNull();
  });
});

describe("extractProjectGid", () => {
  it("pulls the project GID from a project URL", () => {
    expect(extractProjectGid("https://app.asana.com/0/1200000000/list")).toBe(
      "1200000000",
    );
  });

  it("accepts a bare GID", () => {
    expect(extractProjectGid("1200000000")).toBe("1200000000");
  });

  it("returns null for unrecognised text", () => {
    expect(extractProjectGid("not a project")).toBeNull();
  });
});
