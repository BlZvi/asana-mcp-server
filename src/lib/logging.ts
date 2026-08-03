/**
 * Safe logging for a process that holds a bearer token.
 *
 * The Asana SDK (superagent) attaches the whole HTTP request to every error it
 * throws, including the `Authorization: Bearer <token>` header — it appears ~18
 * times in a single failed-request error object. Passing such an error straight
 * to `console.error` writes the caller's Asana token to stderr in plaintext,
 * where it lands in terminal scrollback, MCP client logs, and CI output.
 *
 * Nothing in this server may log a raw error. Use `errorSummary` for structured
 * detail and `redact` for any free-form string.
 */

export const REDACTED = "[REDACTED]";

/**
 * Anything following a `Bearer` scheme keyword, in any serialisation.
 * Covers header strings (`Authorization: Bearer x`) and the nested-array form
 * Node uses for outgoing headers (`authorization: [ 'Authorization', 'Bearer x' ]`).
 */
const BEARER = /(bearer\s+)([\w./+:=-]{8,})/gi;

/**
 * An `authorization` key followed by its value, where no `Bearer` keyword is
 * present. Stops at the first quote/bracket so surrounding structure survives.
 */
const AUTH_KEY = /(authorization["'\s:=[\],]*?)([\w./+:=-]{8,})/gi;

/** Asana personal access tokens: `1/1234567890:hexsecret`. */
const ASANA_PAT = /\b\d\/\d{6,}:[A-Za-z0-9]{8,}\b/g;

/** Strip anything that looks like a credential from a string. */
export function redact(input: string): string {
  return input
    .replace(BEARER, (_m, prefix) => `${prefix}${REDACTED}`)
    .replace(AUTH_KEY, (_m, prefix) => `${prefix}${REDACTED}`)
    .replace(ASANA_PAT, REDACTED);
}

/** HTTP status pulled from the various shapes the Asana SDK produces. */
function statusOf(err: any): number | undefined {
  const candidates = [
    err?.status,
    err?.statusCode,
    err?.response?.status,
    err?.response?.statusCode,
  ];
  for (const c of candidates) {
    const n = typeof c === "string" ? Number.parseInt(c, 10) : c;
    if (typeof n === "number" && Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Asana's own error text, which is far more useful than "Bad Request".
 * Lives at `response.body.errors[].message`.
 */
function asanaErrors(err: any): string[] {
  const raw = err?.response?.body?.errors ?? err?.value?.errors;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e: any) => (typeof e?.message === "string" ? e.message : null))
    .filter((m: string | null): m is string => m !== null);
}

export type ErrorSummary = {
  message: string;
  status?: number;
  asanaErrors?: string[];
  hint?: string;
};

/** Actionable guidance for the failures users actually hit. */
function hintFor(status: number | undefined): string | undefined {
  switch (status) {
    case 401:
      return "ASANA_ACCESS_TOKEN is missing, expired, or invalid.";
    case 403:
      return "The token lacks permission for this resource, or it belongs to a different workspace.";
    case 404:
      return "Not found — check the GID, or the token may not have visibility of it.";
    case 429:
      return "Asana rate limit hit. The client retries automatically; reduce ASANA_MAX_CONCURRENCY if this persists.";
    case 402:
      return "This endpoint requires a paid Asana plan.";
    default:
      return status !== undefined && status >= 500
        ? "Asana server error — transient, safe to retry."
        : undefined;
  }
}

/**
 * Reduce any thrown value to a small, credential-free, loggable object.
 * Never returns the original error or any part of the HTTP request.
 */
export function errorSummary(err: unknown): ErrorSummary {
  if (err instanceof Error === false && typeof err !== "object") {
    return { message: redact(String(err)) };
  }
  const e = err as any;
  const status = statusOf(e);
  const errors = asanaErrors(e);
  const base =
    (typeof e?.message === "string" && e.message) ||
    (errors.length > 0 ? errors[0] : "Unknown error");

  const summary: ErrorSummary = { message: redact(String(base)) };
  if (status !== undefined) summary.status = status;
  if (errors.length > 0) summary.asanaErrors = errors.map(redact);
  const hint = hintFor(status);
  if (hint) summary.hint = hint;
  return summary;
}

/** One-line form for stderr. */
export function formatError(err: unknown): string {
  const s = errorSummary(err);
  const parts = [s.status ? `HTTP ${s.status}` : null, s.message].filter(
    Boolean,
  );
  if (s.asanaErrors && s.asanaErrors.length > 1) {
    parts.push(`(+${s.asanaErrors.length - 1} more)`);
  }
  return parts.join(" — ");
}

/**
 * stderr logger that redacts every argument.
 *
 * Use instead of `console.error` anywhere an error or API payload might be
 * involved.
 */
export function logError(context: string, err: unknown): void {
  console.error(`${context}: ${formatError(err)}`);
}

export function logInfo(message: string): void {
  console.error(redact(message));
}
