import { describe, it, expect } from "vitest";
import {
  createParty,
  joinParty,
  leaveParty,
  updateSettings,
  memberCount,
  isEmpty,
  isExpired,
  usesPositions,
  MAX_PARTY,
} from "../src/domain/party";

const NOW = 1_700_000_000_000;
const FUTURE = NOW + 3_600_000;
const base = (patch = {}) => createParty("p1", { queue: "SOLO", ...patch }, NOW);
const err = (code: string) => expect.objectContaining({ code });

describe("createParty", () => {
  it("creates a party with defaults and no members", () => {
    const p = base();
    expect(p.id).toBe("p1");
    expect(p.settings.queue).toBe("SOLO");
    expect(p.settings.tier).toBe("ANY");
    expect(memberCount(p)).toBe(0);
  });

  it("validates queue, tier and a future time", () => {
    expect(() => createParty("p", { queue: "URF" }, NOW)).toThrowError(err("INVALID_QUEUE"));
    expect(() => createParty("p", { queue: "SOLO", tier: "WOOD" }, NOW)).toThrowError(err("INVALID_TIER"));
    expect(() => createParty("p", { queue: "SOLO", scheduledAt: NOW - 1 }, NOW)).toThrowError(err("INVALID_TIME"));
    expect(createParty("p", { queue: "SOLO", scheduledAt: FUTURE }, NOW).settings.scheduledAt).toBe(FUTURE);
  });

  it("rejects an absurdly far future time (e.g. a 6-digit year)", () => {
    const farFuture = NOW + 400 * 24 * 3600 * 1000;
    expect(() => createParty("p", { queue: "SOLO", scheduledAt: farFuture }, NOW)).toThrowError(err("INVALID_TIME"));
  });
});

describe("joinParty — position queue", () => {
  it("adds a member at a position", () => {
    const p = joinParty(base(), { clientId: "c1", nickname: "A", position: "MID", now: NOW });
    expect(memberCount(p)).toBe(1);
    expect(p.members[0]?.position).toBe("MID");
  });

  it("allows several members on the same position", () => {
    let p = joinParty(base(), { clientId: "c1", nickname: "A", position: "MID", now: NOW });
    p = joinParty(p, { clientId: "c2", nickname: "B", position: "MID", now: NOW });
    expect(memberCount(p)).toBe(2);
    expect(p.members.every((m) => m.position === "MID")).toBe(true);
  });

  it("moves an existing member when they change position (one membership per client)", () => {
    let p = joinParty(base(), { clientId: "c1", nickname: "A", position: "MID", now: NOW });
    p = joinParty(p, { clientId: "c1", nickname: "A", position: "TOP", now: NOW });
    expect(memberCount(p)).toBe(1);
    expect(p.members[0]?.position).toBe("TOP");
  });

  it("caps the party at 5 members", () => {
    let p = base();
    for (const c of ["c1", "c2", "c3", "c4", "c5"]) {
      p = joinParty(p, { clientId: c, nickname: c, position: "MID", now: NOW });
    }
    expect(memberCount(p)).toBe(MAX_PARTY);
    expect(() => joinParty(p, { clientId: "c6", nickname: "F", position: "MID", now: NOW })).toThrowError(
      err("PARTY_FULL"),
    );
  });

  it("rejects an invalid/missing position", () => {
    expect(() => joinParty(base(), { clientId: "c1", nickname: "A", position: "ZZZ", now: NOW })).toThrowError(
      err("INVALID_POSITION"),
    );
  });
});

describe("joinParty — ARAM has no positions", () => {
  it("ignores position for ARAM and stores null", () => {
    const p = joinParty(base({ queue: "ARAM" }), { clientId: "c1", nickname: "A", position: "MID", now: NOW });
    expect(p.members[0]?.position).toBeNull();
  });

  it("usesPositions: false for ARAM, true otherwise", () => {
    expect(usesPositions("ARAM")).toBe(false);
    expect(usesPositions("SOLO")).toBe(true);
  });
});

describe("updateSettings", () => {
  it("clears member positions when switching to ARAM", () => {
    let p = joinParty(base(), { clientId: "c1", nickname: "A", position: "MID", now: NOW });
    p = updateSettings(p, { queue: "ARAM" }, NOW);
    expect(p.members[0]?.position).toBeNull();
  });
});

describe("leaveParty & lifecycle", () => {
  it("removes a member and reports empty", () => {
    let p = joinParty(base(), { clientId: "c1", nickname: "A", position: "MID", now: NOW });
    p = leaveParty(p, "c1");
    expect(isEmpty(p)).toBe(true);
  });

  it("isExpired only after the scheduled time", () => {
    const p = createParty("p", { queue: "SOLO", scheduledAt: FUTURE }, NOW);
    expect(isExpired(p, NOW)).toBe(false);
    expect(isExpired(p, FUTURE)).toBe(true);
  });
});
