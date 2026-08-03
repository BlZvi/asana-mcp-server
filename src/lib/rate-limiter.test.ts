import { describe, expect, it } from "vitest";
import {
  extractRetryAfterMs,
  extractStatus,
  isRetryableStatus,
  mapWithConcurrency,
  RateLimiter,
  RequestBudget,
} from "./rate-limiter.js";

/** Superagent surfaces status in several places depending on the failure. */
describe("extractStatus", () => {
  it("reads err.status", () => {
    expect(extractStatus({ status: 429 })).toBe(429);
  });
  it("reads err.statusCode", () => {
    expect(extractStatus({ statusCode: 500 })).toBe(500);
  });
  it("reads err.response.status", () => {
    expect(extractStatus({ response: { status: 404 } })).toBe(404);
  });
  it("returns undefined when there is no status", () => {
    expect(extractStatus(new Error("network down"))).toBeUndefined();
    expect(extractStatus(null)).toBeUndefined();
    expect(extractStatus("nope")).toBeUndefined();
  });
  it("ignores values outside the HTTP range", () => {
    expect(extractStatus({ status: 99 })).toBeUndefined();
    expect(extractStatus({ status: 9999 })).toBeUndefined();
  });
});

describe("extractRetryAfterMs", () => {
  it("parses delta-seconds", () => {
    expect(
      extractRetryAfterMs({ response: { headers: { "retry-after": "2" } } }),
    ).toBe(2000);
  });
  it("is case insensitive about the header name", () => {
    expect(
      extractRetryAfterMs({ response: { headers: { "Retry-After": "3" } } }),
    ).toBe(3000);
  });
  it("parses the HTTP-date form", () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const ms = extractRetryAfterMs({
      response: { headers: { "retry-after": future } },
    });
    expect(ms).toBeGreaterThan(1000);
    expect(ms).toBeLessThanOrEqual(6000);
  });
  it("returns undefined when absent or unparseable", () => {
    expect(extractRetryAfterMs({ response: { headers: {} } })).toBeUndefined();
    expect(extractRetryAfterMs({})).toBeUndefined();
  });
});

describe("isRetryableStatus", () => {
  it("retries 429 and 5xx", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
  });
  it("does not retry other 4xx", () => {
    for (const s of [400, 401, 403, 404, 422]) {
      expect(isRetryableStatus(s)).toBe(false);
    }
  });
  it("does not retry an unknown status", () => {
    expect(isRetryableStatus(undefined)).toBe(false);
  });
});

describe("RateLimiter", () => {
  it("returns the result of a successful call", async () => {
    const limiter = new RateLimiter({ minIntervalMs: 0 });
    await expect(limiter.run(async () => "ok")).resolves.toBe("ok");
  });

  it("retries a 429 and then succeeds", async () => {
    const limiter = new RateLimiter({ minIntervalMs: 0, maxRetries: 3 });
    let attempts = 0;
    const result = await limiter.run(async () => {
      attempts++;
      if (attempts === 1) {
        const e: any = new Error("Too Many Requests");
        e.status = 429;
        e.response = { headers: { "retry-after": "0" } };
        throw e;
      }
      return "recovered";
    });
    expect(result).toBe("recovered");
    expect(attempts).toBe(2);
  });

  it("does not retry a 401 — a bad token will never fix itself", async () => {
    const limiter = new RateLimiter({ minIntervalMs: 0, maxRetries: 3 });
    let attempts = 0;
    await expect(
      limiter.run(async () => {
        attempts++;
        const e: any = new Error("Unauthorized");
        e.status = 401;
        throw e;
      }),
    ).rejects.toThrow("Unauthorized");
    expect(attempts).toBe(1);
  });

  it("gives up after maxRetries and rethrows", async () => {
    const limiter = new RateLimiter({ minIntervalMs: 0, maxRetries: 2 });
    let attempts = 0;
    await expect(
      limiter.run(async () => {
        attempts++;
        // 429 with Retry-After: 0 keeps this fast. Retry-After is only
        // honoured for 429 — 5xx responses rarely carry it, so those use the
        // exponential ladder (covered separately below).
        const e: any = new Error("Too Many Requests");
        e.status = 429;
        e.response = { headers: { "retry-after": "0" } };
        throw e;
      }),
    ).rejects.toThrow("Too Many Requests");
    expect(attempts).toBe(3);
  });

  it("falls back to exponential backoff when Retry-After is absent", async () => {
    const limiter = new RateLimiter({ minIntervalMs: 0, maxRetries: 1 });
    let attempts = 0;
    const started = Date.now();
    await expect(
      limiter.run(async () => {
        attempts++;
        const e: any = new Error("Server Error");
        e.status = 503;
        throw e;
      }),
    ).rejects.toThrow("Server Error");
    expect(attempts).toBe(2);
    // First backoff step is ~1s; assert it actually waited rather than spun.
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });

  it("never exceeds maxConcurrent in flight", async () => {
    const limiter = new RateLimiter({ maxConcurrent: 2, minIntervalMs: 0 });
    let inFlight = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        limiter.run(async () => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 10));
          inFlight--;
        }),
      ),
    );
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("RequestBudget", () => {
  it("allows spending up to the limit", () => {
    const b = new RequestBudget(3);
    expect(b.consume()).toBe(true);
    expect(b.consume(2)).toBe(true);
    expect(b.used).toBe(3);
    expect(b.remaining).toBe(0);
  });

  it("refuses to overspend and reports exhaustion", () => {
    const b = new RequestBudget(2);
    expect(b.consume(2)).toBe(true);
    expect(b.consume()).toBe(false);
    expect(b.exhausted).toBe(true);
  });

  it("rejects a request larger than the whole budget", () => {
    expect(new RequestBudget(5).consume(10)).toBe(false);
  });
});

describe("mapWithConcurrency", () => {
  it("preserves input order regardless of completion order", async () => {
    const out = await mapWithConcurrency([30, 5, 20, 1], 4, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3]);
  });

  it("respects the concurrency ceiling", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 10 }), 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("handles an empty input", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});
