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

describe("joinParty — multi-lane (position queue)", () => {
  const join = (party: ReturnType<typeof base>, over: Record<string, unknown> = {}) =>
    joinParty(party, { clientId: "c1", nickname: "A", positions: ["MID"], now: NOW, ...over });

  it("stores multiple selected lanes for one member", () => {
    const p = join(base(), { positions: ["MID", "TOP", "JGL"] });
    expect(memberCount(p)).toBe(1);
    expect(p.members[0]?.positions).toEqual(["TOP", "JGL", "MID"]); // canonical order
  });

  it("dedupes repeated lanes", () => {
    const p = join(base(), { positions: ["MID", "MID", "TOP"] });
    expect(p.members[0]?.positions).toEqual(["TOP", "MID"]);
  });

  it("lets different people share the same lane", () => {
    let p = join(base(), { clientId: "c1", nickname: "A", positions: ["MID"] });
    p = join(p, { clientId: "c2", nickname: "B", positions: ["MID"] });
    expect(memberCount(p)).toBe(2);
    expect(p.members.every((m) => m.positions.includes("MID"))).toBe(true);
  });

  it("replaces a member's lanes and nickname when they re-join", () => {
    let p = join(base(), { clientId: "c1", nickname: "A", positions: ["MID"] });
    p = join(p, { clientId: "c1", nickname: "A2", positions: ["TOP", "ADC"] });
    expect(memberCount(p)).toBe(1);
    expect(p.members[0]?.nickname).toBe("A2");
    expect(p.members[0]?.positions).toEqual(["TOP", "ADC"]);
  });

  it("caps the party at 5 distinct people", () => {
    let p = base();
    for (const c of ["c1", "c2", "c3", "c4", "c5"]) {
      p = join(p, { clientId: c, nickname: c, positions: ["MID"] });
    }
    expect(memberCount(p)).toBe(MAX_PARTY);
    expect(() => join(p, { clientId: "c6", nickname: "F", positions: ["MID"] })).toThrowError(err("PARTY_FULL"));
  });

  it("requires at least one valid lane", () => {
    expect(() => join(base(), { positions: [] })).toThrowError(err("INVALID_POSITION"));
    expect(() => join(base(), { positions: ["ZZZ"] })).toThrowError(err("INVALID_POSITION"));
    expect(() => join(base(), { positions: undefined })).toThrowError(err("INVALID_POSITION"));
  });
});

describe("joinParty — ARAM has no lanes", () => {
  it("ignores lanes for ARAM and stores empty positions", () => {
    const p = joinParty(base({ queue: "ARAM" }), { clientId: "c1", nickname: "A", positions: ["MID"], now: NOW });
    expect(p.members[0]?.positions).toEqual([]);
  });

  it("usesPositions: false for ARAM, true otherwise", () => {
    expect(usesPositions("ARAM")).toBe(false);
    expect(usesPositions("SOLO")).toBe(true);
  });
});

describe("updateSettings", () => {
  it("clears member lanes when switching to ARAM", () => {
    let p = joinParty(base(), { clientId: "c1", nickname: "A", positions: ["MID", "TOP"], now: NOW });
    p = updateSettings(p, { queue: "ARAM" }, NOW);
    expect(p.members[0]?.positions).toEqual([]);
  });
});

describe("leaveParty & lifecycle", () => {
  it("removes a member and reports empty", () => {
    let p = joinParty(base(), { clientId: "c1", nickname: "A", positions: ["MID"], now: NOW });
    p = leaveParty(p, "c1");
    expect(isEmpty(p)).toBe(true);
  });

  it("isExpired only after the scheduled time", () => {
    const p = createParty("p", { queue: "SOLO", scheduledAt: FUTURE }, NOW);
    expect(isExpired(p, NOW)).toBe(false);
    expect(isExpired(p, FUTURE)).toBe(true);
  });
});
