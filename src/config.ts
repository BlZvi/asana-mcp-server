/**
 * Environment-derived configuration.
 *
 * Bad or missing values always degrade to a sane default — configuration
 * parsing must never throw, or the server fails to start.
 */

/**
 * Read an integer env var, clamped to `[min, max]`.
 * Returns `def` when the variable is missing, unparseable, or out of range.
 */
function parseIntEnv(
  name: string,
  def: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return def;

  const parsed = Number.parseInt(raw.trim(), 10);
  if (Number.isNaN(parsed)) return def;
  if (parsed < min || parsed > max) return def;
  return parsed;
}

/**
 * Read a comma-separated list of weekday numbers (0 = Sunday … 6 = Saturday).
 * Returns `def` when the variable is missing or contains no valid entries.
 */
function parseBusinessDaysEnv(name: string, def: number[]): number[] {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return def;

  const days = new Set<number>();
  for (const part of raw.split(",")) {
    const parsed = Number.parseInt(part.trim(), 10);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 6) days.add(parsed);
  }

  return days.size > 0 ? [...days].sort((a, b) => a - b) : def;
}

export const isReadOnlyMode = process.env.ASANA_READ_ONLY_MODE === "true";
export const defaultWorkspaceGid = process.env.ASANA_DEFAULT_WORKSPACE_GID;

/** When true, mutating tools describe what they would do instead of doing it. */
export const isDryRunMode = process.env.ASANA_DRY_RUN === "true";

/** IANA timezone used for all "today"/due-date reasoning. */
export const asanaTimezone = process.env.ASANA_TIMEZONE ?? "UTC";

/** Maximum simultaneous Asana API calls. */
export const maxConcurrency = parseIntEnv("ASANA_MAX_CONCURRENCY", 4, 1, 10);

/** Ceiling on API requests a single prompt may spend. */
export const maxRequestsPerPrompt = parseIntEnv(
  "ASANA_MAX_REQUESTS_PER_PROMPT",
  80,
  10,
  500,
);

/** When true, all caching is bypassed. */
export const cacheDisabled = process.env.ASANA_CACHE_DISABLED === "true";

/** Explicit GID of the story-points custom field, when known. */
export const pointsFieldGid = process.env.ASANA_POINTS_FIELD_GID;

/** Regex used to discover the story-points field by name when no GID is set. */
export const pointsFieldNamePattern =
  process.env.ASANA_POINTS_FIELD_NAME ?? "^(story )?points?$|^estimate$|^size$";

/** Nominal sprint length in days. */
export const sprintLengthDays = parseIntEnv(
  "ASANA_SPRINT_LENGTH_DAYS",
  14,
  1,
  90,
);

/** Working days of the week (0 = Sunday … 6 = Saturday). */
export const businessDays = parseBusinessDaysEnv(
  "ASANA_BUSINESS_DAYS",
  [1, 2, 3, 4, 5],
);

export function resolveWorkspace(workspace: string | undefined): string {
  const resolved = workspace ?? defaultWorkspaceGid;
  if (!resolved)
    throw new Error(
      "workspace is required — pass it explicitly or set the ASANA_DEFAULT_WORKSPACE_GID environment variable",
    );
  return resolved;
}

/**
 * Non-throwing variant of {@link resolveWorkspace}.
 * Autocomplete callbacks must never throw, so they use this instead.
 */
export function resolveWorkspaceOptional(
  workspace: string | undefined,
): string | undefined {
  return workspace ?? defaultWorkspaceGid;
}
