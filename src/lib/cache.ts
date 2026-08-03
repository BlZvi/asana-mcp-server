/**
 * In-memory TTL cache with LRU eviction and in-flight request de-duplication.
 *
 * Nothing here is persisted; the cache lives and dies with the process.
 */

/** Default maximum number of retained entries before LRU eviction kicks in. */
const DEFAULT_MAX_ENTRIES = 500;

/** Standard cache lifetimes, keyed by how volatile the underlying data is. */
export const TTL = {
  /** Data that can no longer change (closed sprints, past dates). */
  HISTORICAL: 15 * 60 * 1000,
  /** Live data that changes as people work. */
  CURRENT: 60 * 1000,
  /** Slow-moving lookup data (users, custom fields, projects). */
  REFERENCE: 10 * 60 * 1000,
} as const;

export interface TTLCacheOptions {
  /** Maximum retained entries. Default 500. */
  maxEntries?: number;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

/**
 * Recursively sort object keys so that structurally equal arguments produce
 * byte-identical JSON regardless of property insertion order.
 * Arrays keep their order (it is semantically meaningful).
 */
function stableNormalize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") {
    // `undefined` is preserved as a sentinel so it survives JSON.stringify,
    // which would otherwise drop the property entirely.
    return value === undefined ? "__undefined__" : value;
  }

  if (seen.has(value as object)) return "__circular__";
  seen.add(value as object);

  try {
    if (Array.isArray(value)) {
      return value.map((item) => stableNormalize(item, seen));
    }

    if (value instanceof Date) return value.toISOString();

    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = stableNormalize(source[key], seen);
    }
    return out;
  } finally {
    seen.delete(value as object);
  }
}

/**
 * Build a deterministic cache key from a method name and its arguments.
 * Object key order does not affect the result.
 */
export function cacheKey(method: string, args: unknown): string {
  return `${method}:${JSON.stringify(stableNormalize(args, new WeakSet<object>()))}`;
}

export class TTLCache {
  private readonly maxEntries: number;
  /** Map iteration order is insertion order, which we exploit for LRU. */
  private readonly entries = new Map<string, Entry>();
  /** Promises for keys currently being computed, so concurrent callers share one call. */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(opts: TTLCacheOptions = {}) {
    this.maxEntries = Math.max(
      1,
      Math.trunc(opts.maxEntries ?? DEFAULT_MAX_ENTRIES),
    );
  }

  /** Returns the cached value, or undefined when missing or expired. */
  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    // Mark as most-recently-used by reinserting at the tail.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value as T;
  }

  /** Store a value for `ttlMs`. A non-positive TTL stores nothing. */
  set<T>(key: string, value: T, ttlMs: number): void {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      this.entries.delete(key);
      return;
    }

    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    this.evictIfNeeded();
  }

  /**
   * Return the cached value, or compute it via `factory` and cache the result.
   * Concurrent callers for the same key share a single `factory` invocation.
   * Failures are never cached.
   */
  async getOrSet<T>(
    key: string,
    ttlMs: number,
    factory: () => Promise<T>,
  ): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;

    const pending = this.inFlight.get(key);
    if (pending) return pending as Promise<T>;

    const promise = (async () => {
      const value = await factory();
      this.set(key, value, ttlMs);
      return value;
    })();

    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      // Cleared on success *and* failure so a rejection is never sticky.
      this.inFlight.delete(key);
    }
  }

  /** Drop all entries and forget any in-flight de-duplication. */
  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }

  /** Number of retained entries, including any not yet lazily expired. */
  get size(): number {
    return this.entries.size;
  }

  /** Evict least-recently-used entries until within the size limit. */
  private evictIfNeeded(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}
