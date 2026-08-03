/**
 * Concurrency control, request pacing and retry/backoff helpers.
 *
 * The Asana SDK throws errors with inconsistent shapes depending on which
 * transport layer produced them, so status/header extraction here is
 * deliberately defensive and never throws.
 */

/** Default number of simultaneous in-flight calls. */
const DEFAULT_MAX_CONCURRENT = 4;
/** Default minimum spacing between two dispatches, in milliseconds. */
const DEFAULT_MIN_INTERVAL_MS = 120;
/** Default number of retries attempted *after* the initial call. */
const DEFAULT_MAX_RETRIES = 3;
/** Backoff schedule applied to retryable failures. */
const BACKOFF_MS = [1000, 2000, 4000, 8000] as const;

export interface RateLimiterOptions {
  /** Maximum simultaneous in-flight calls. Default 4. */
  maxConcurrent?: number;
  /** Minimum delay between two dispatches. Default 120ms. */
  minIntervalMs?: number;
  /** Retries attempted after the initial call. Default 3. */
  maxRetries?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Coerce an unknown value to a positive finite number, or undefined. */
function toNumber(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** Read a header case-insensitively from a plain object or a Headers-like object. */
function readHeader(headers: unknown, name: string): unknown {
  if (!headers || typeof headers !== "object") return undefined;

  const getter = (headers as { get?: unknown }).get;
  if (typeof getter === "function") {
    try {
      const value = (getter as (key: string) => unknown).call(headers, name);
      if (value !== null && value !== undefined) return value;
    } catch {
      // Fall through to plain-object lookup.
    }
  }

  const bag = headers as Record<string, unknown>;
  const lower = name.toLowerCase();
  for (const key of Object.keys(bag)) {
    if (key.toLowerCase() === lower) return bag[key];
  }
  return undefined;
}

/**
 * Pull an HTTP status code out of an unknown error.
 * Checks `err.status`, `err.statusCode`, `err.response.status` and
 * `err.response.statusCode`. Returns undefined when nothing looks like a status.
 */
export function extractStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as Record<string, any>;

  const candidates: unknown[] = [
    e.status,
    e.statusCode,
    e.response?.status,
    e.response?.statusCode,
  ];

  for (const candidate of candidates) {
    const num = toNumber(candidate);
    if (num !== undefined && num >= 100 && num < 600) return Math.trunc(num);
  }
  return undefined;
}

/**
 * Pull a `Retry-After` delay (in milliseconds) out of an unknown error.
 * Accepts both the delta-seconds form and the HTTP-date form.
 * Returns undefined when the header is absent or unparseable.
 */
export function extractRetryAfterMs(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as Record<string, any>;

  const raw =
    readHeader(e.response?.headers, "retry-after") ??
    readHeader(e.headers, "retry-after") ??
    readHeader(e.response?.header, "retry-after");

  if (raw === undefined || raw === null) return undefined;

  // Some clients expose repeated headers as arrays.
  const value = Array.isArray(raw) ? raw[0] : raw;

  const seconds = toNumber(value);
  if (seconds !== undefined) return Math.max(0, Math.round(seconds * 1000));

  if (typeof value === "string") {
    const at = Date.parse(value);
    if (!Number.isNaN(at)) return Math.max(0, at - Date.now());
  }
  return undefined;
}

/** True for 429 and any 5xx. Unknown/absent statuses are treated as non-retryable. */
export function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return false;
  return status === 429 || (status >= 500 && status < 600);
}

/** FIFO counting semaphore. */
class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly max: number) {}

  acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  release(): void {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }
}

/**
 * Serialises access to the Asana API: caps concurrency, paces dispatches and
 * retries throttled / transient failures with exponential backoff.
 */
export class RateLimiter {
  private readonly semaphore: Semaphore;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  /** Earliest timestamp at which the next dispatch may happen. */
  private nextSlotAt = 0;

  constructor(opts: RateLimiterOptions = {}) {
    const maxConcurrent = Math.max(
      1,
      Math.trunc(opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT),
    );
    this.semaphore = new Semaphore(maxConcurrent);
    this.minIntervalMs = Math.max(
      0,
      opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS,
    );
    this.maxRetries = Math.max(
      0,
      Math.trunc(opts.maxRetries ?? DEFAULT_MAX_RETRIES),
    );
  }

  /**
   * Reserve the next pacing slot and wait for it.
   * The slot is claimed synchronously so concurrent callers cannot collide.
   */
  private async awaitDispatchSlot(): Promise<void> {
    const now = Date.now();
    const target = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = target + this.minIntervalMs;
    const delay = target - now;
    if (delay > 0) await sleep(delay);
  }

  /** Run `fn` under the concurrency limit, pacing and retry policy. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let caught: unknown;

      await this.semaphore.acquire();
      try {
        await this.awaitDispatchSlot();
        return await fn();
      } catch (err) {
        caught = err;
      } finally {
        this.semaphore.release();
      }

      const status = extractStatus(caught);
      if (attempt >= this.maxRetries || !isRetryableStatus(status))
        throw caught;

      const retryAfter =
        status === 429 ? extractRetryAfterMs(caught) : undefined;
      const backoff = BACKOFF_MS[
        Math.min(attempt, BACKOFF_MS.length - 1)
      ] as number;
      // Sleep *after* releasing the semaphore so a throttled call does not
      // hold a concurrency slot hostage while it waits.
      await sleep(retryAfter ?? backoff);
    }
  }
}

/**
 * Hard ceiling on the number of API requests a single prompt may spend.
 * Purely an accounting device — it never performs I/O.
 */
export class RequestBudget {
  private readonly max: number;
  private spent = 0;

  constructor(max: number) {
    this.max = Math.max(0, Math.trunc(max));
  }

  /** Consume `n` units. Returns false and consumes nothing if it would exceed the budget. */
  consume(n = 1): boolean {
    const amount = Math.max(0, Math.trunc(n));
    if (this.spent + amount > this.max) return false;
    this.spent += amount;
    return true;
  }

  get used(): number {
    return this.spent;
  }

  get remaining(): number {
    return Math.max(0, this.max - this.spent);
  }

  get exhausted(): boolean {
    return this.spent >= this.max;
  }
}

/**
 * Map over `items` with a bounded worker pool.
 * Output order always matches input order, regardless of completion order.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;

  const workers = Math.max(
    1,
    Math.min(Math.trunc(concurrency) || 1, items.length),
  );
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T, index);
    }
  };

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
