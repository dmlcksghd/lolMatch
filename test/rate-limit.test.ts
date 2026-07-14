import { describe, it, expect } from "vitest";
import { RateLimiter } from "../src/server/rate-limit";

describe("RateLimiter", () => {
  it("allows up to the configured max within a window", () => {
    let now = 0;
    const limiter = new RateLimiter({ max: 3, windowMs: 1000 }, () => now);
    expect(limiter.consume("s1")).toBe(true);
    expect(limiter.consume("s1")).toBe(true);
    expect(limiter.consume("s1")).toBe(true);
  });

  it("blocks once the max is exceeded within the same window", () => {
    let now = 0;
    const limiter = new RateLimiter({ max: 2, windowMs: 1000 }, () => now);
    expect(limiter.consume("s1")).toBe(true);
    expect(limiter.consume("s1")).toBe(true);
    expect(limiter.consume("s1")).toBe(false);
  });

  it("resets the budget once the window elapses", () => {
    let now = 0;
    const limiter = new RateLimiter({ max: 1, windowMs: 1000 }, () => now);
    expect(limiter.consume("s1")).toBe(true);
    expect(limiter.consume("s1")).toBe(false);
    now = 1000;
    expect(limiter.consume("s1")).toBe(true);
  });

  it("tracks each key independently", () => {
    let now = 0;
    const limiter = new RateLimiter({ max: 1, windowMs: 1000 }, () => now);
    expect(limiter.consume("s1")).toBe(true);
    expect(limiter.consume("s2")).toBe(true);
    expect(limiter.consume("s1")).toBe(false);
    expect(limiter.consume("s2")).toBe(false);
  });

  it("clear() forgets a key so its next hit starts a fresh window", () => {
    let now = 0;
    const limiter = new RateLimiter({ max: 1, windowMs: 1000 }, () => now);
    expect(limiter.consume("s1")).toBe(true);
    expect(limiter.consume("s1")).toBe(false);
    limiter.clear("s1");
    expect(limiter.consume("s1")).toBe(true);
  });

  it("size() reflects the number of tracked keys", () => {
    let now = 0;
    const limiter = new RateLimiter({ max: 1, windowMs: 1000 }, () => now);
    limiter.consume("s1");
    limiter.consume("s2");
    expect(limiter.size()).toBe(2);
    limiter.clear("s1");
    expect(limiter.size()).toBe(1);
  });

  it("defaults now() to Date.now when not injected", () => {
    const limiter = new RateLimiter({ max: 1, windowMs: 1000 });
    expect(limiter.consume("s1")).toBe(true);
  });
});
