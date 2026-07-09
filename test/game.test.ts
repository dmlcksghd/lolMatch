import { describe, it, expect } from "vitest";
import {
  createGame,
  updateSettings,
  isExpired,
  expireIfDue,
  claimSeat,
  filled,
  DEFAULT_SETTINGS,
} from "../src/domain/game";

const NOW = 1_700_000_000_000;
const FUTURE = NOW + 3_600_000;
const PAST = NOW - 1_000;

describe("createGame", () => {
  it("starts as game 1 with default settings and an empty roster", () => {
    const g = createGame();
    expect(g.id).toBe(1);
    expect(g.settings).toEqual(DEFAULT_SETTINGS);
    expect(filled(g)).toBe(0);
  });
});

describe("updateSettings", () => {
  it("updates tier and queue", () => {
    const g = updateSettings(createGame(), { tier: "GOLD", queue: "ARAM" }, NOW);
    expect(g.settings.tier).toBe("GOLD");
    expect(g.settings.queue).toBe("ARAM");
  });

  it("accepts a future scheduled time and clears it with null", () => {
    const g1 = updateSettings(createGame(), { scheduledAt: FUTURE }, NOW);
    expect(g1.settings.scheduledAt).toBe(FUTURE);
    const g2 = updateSettings(g1, { scheduledAt: null }, NOW);
    expect(g2.settings.scheduledAt).toBeNull();
  });

  it("rejects an invalid tier", () => {
    expect(() => updateSettings(createGame(), { tier: "WOOD" }, NOW)).toThrowError(
      expect.objectContaining({ code: "INVALID_TIER" }),
    );
  });

  it("rejects an invalid queue", () => {
    expect(() => updateSettings(createGame(), { queue: "URF" }, NOW)).toThrowError(
      expect.objectContaining({ code: "INVALID_QUEUE" }),
    );
  });

  it("rejects a scheduled time in the past", () => {
    expect(() => updateSettings(createGame(), { scheduledAt: PAST }, NOW)).toThrowError(
      expect.objectContaining({ code: "INVALID_TIME" }),
    );
  });

  it("does not mutate the previous game", () => {
    const g = createGame();
    updateSettings(g, { tier: "DIAMOND" }, NOW);
    expect(g.settings.tier).toBe(DEFAULT_SETTINGS.tier);
  });
});

describe("expiry", () => {
  it("is not expired without a scheduled time", () => {
    expect(isExpired(createGame(), NOW)).toBe(false);
  });

  it("is not expired before the scheduled time", () => {
    const g = updateSettings(createGame(), { scheduledAt: FUTURE }, NOW);
    expect(isExpired(g, NOW)).toBe(false);
  });

  it("is expired at or after the scheduled time", () => {
    const g = updateSettings(createGame(), { scheduledAt: FUTURE }, NOW);
    expect(isExpired(g, FUTURE)).toBe(true);
  });

  it("expireIfDue returns the same game when not due", () => {
    const g = updateSettings(createGame(), { scheduledAt: FUTURE }, NOW);
    expect(expireIfDue(g, NOW)).toBe(g);
  });

  it("expireIfDue opens a fresh game (id+1, empty roster, time cleared, tier/queue kept)", () => {
    let g = updateSettings(createGame(), { tier: "GOLD", queue: "ARAM", scheduledAt: FUTURE }, NOW);
    g = claimSeat(g, { position: "MID", nickname: "A", ownerId: "c1", now: NOW });
    const next = expireIfDue(g, FUTURE);
    expect(next.id).toBe(2);
    expect(filled(next)).toBe(0);
    expect(next.settings.scheduledAt).toBeNull();
    expect(next.settings.tier).toBe("GOLD");
    expect(next.settings.queue).toBe("ARAM");
  });
});

describe("seat delegation uses clientId as owner", () => {
  it("claims a seat for a client and reports filled", () => {
    const g = claimSeat(createGame(), { position: "TOP", nickname: "방장", ownerId: "client-uuid", now: NOW });
    expect(g.roster.seats.TOP?.ownerId).toBe("client-uuid");
    expect(filled(g)).toBe(1);
  });
});
