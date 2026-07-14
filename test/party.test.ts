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
const OWNER = "owner-1";
const base = (patch = {}) => createParty("p1", { queue: "SOLO", ...patch }, NOW, OWNER);
const err = (code: string) => expect.objectContaining({ code });

describe("createParty", () => {
  it("creates a party with defaults and no members", () => {
    const p = base();
    expect(p.settings.queue).toBe("SOLO");
    expect(p.settings.tier).toBe("ANY");
    expect(memberCount(p)).toBe(0);
  });

  it("assigns the given ownerId to the new party", () => {
    expect(base().ownerId).toBe(OWNER);
  });

  it("validates queue, tier and a future time", () => {
    expect(() => createParty("p", { queue: "URF" }, NOW, OWNER)).toThrowError(err("INVALID_QUEUE"));
    expect(() => createParty("p", { queue: "SOLO", tier: "WOOD" }, NOW, OWNER)).toThrowError(err("INVALID_TIER"));
    expect(() => createParty("p", { queue: "SOLO", scheduledAt: NOW - 1 }, NOW, OWNER)).toThrowError(err("INVALID_TIME"));
    expect(createParty("p", { queue: "SOLO", scheduledAt: FUTURE }, NOW, OWNER).settings.scheduledAt).toBe(FUTURE);
  });

  it("rejects an absurdly far future time (e.g. a 6-digit year)", () => {
    const farFuture = NOW + 400 * 24 * 3600 * 1000;
    expect(() => createParty("p", { queue: "SOLO", scheduledAt: farFuture }, NOW, OWNER)).toThrowError(err("INVALID_TIME"));
  });

  it("rejects a scheduledAt that isn't a finite number", () => {
    expect(() => createParty("p", { queue: "SOLO", scheduledAt: "tomorrow" }, NOW, OWNER)).toThrowError(err("INVALID_TIME"));
    expect(() => createParty("p", { queue: "SOLO", scheduledAt: NaN }, NOW, OWNER)).toThrowError(err("INVALID_TIME"));
  });
});

describe("joinParty — multi-lane (position queue)", () => {
  const join = (party: ReturnType<typeof base>, over: Record<string, unknown> = {}) =>
    joinParty(party, { clientId: "c1", nickname: "A", positions: ["MID"], now: NOW, ...over });

  it("stores multiple selected lanes for one member", () => {
    const p = join(base(), { positions: ["MID", "TOP", "JGL"] });
    expect(memberCount(p)).toBe(1);
    expect(p.members[0]?.positions).toEqual(["TOP", "JGL", "MID"]); // 항상 탑→정글→미드→원딜→서폿 순서로 정렬됨
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

  it("updates the tier when a valid tier is patched", () => {
    const p = updateSettings(base(), { tier: "GOLD" }, NOW);
    expect(p.settings.tier).toBe("GOLD");
  });

  it("removes members with no lane when switching from ARAM to a positional queue (no ghost members)", () => {
    let p = joinParty(base({ queue: "ARAM" }), { clientId: "c1", nickname: "A", now: NOW });
    p = joinParty(p, { clientId: "c2", nickname: "B", now: NOW });
    expect(memberCount(p)).toBe(2);
    p = updateSettings(p, { queue: "SOLO" }, NOW);
    // 칼바람 멤버는 애초에 라인을 골라본 적이 없다. 그 상태로 라인이 있는 큐로 바뀌면
    // 화면 어디에도 안 보이면서 자리만 차지하는 '유령 인원'이 되어버리므로, 그냥 두지 말고
    // 파티에서 내보내야 한다.
    expect(memberCount(p)).toBe(0);
    expect(p.members.every((m) => m.positions.length > 0)).toBe(true);
  });

  it("keeps members who already have lanes when switching between positional queues", () => {
    let p = joinParty(base(), { clientId: "c1", nickname: "A", positions: ["MID"], now: NOW });
    p = updateSettings(p, { queue: "FLEX" }, NOW);
    expect(memberCount(p)).toBe(1);
    expect(p.members[0]?.positions).toEqual(["MID"]);
  });

  it("reassigns ownership when the owner is dropped as a ghost member on transition", () => {
    let p = joinParty(base({ queue: "ARAM" }), { clientId: OWNER, nickname: "Owner", now: NOW });
    p = joinParty(p, { clientId: "c2", nickname: "B", now: NOW });
    expect(p.ownerId).toBe(OWNER);
    // 방장도 라인을 골라본 적이 없으므로 다른 사람들과 함께 파티에서 빠지고, 결국 아무도 안 남는다.
    p = updateSettings(p, { queue: "SOLO" }, NOW);
    expect(memberCount(p)).toBe(0);
  });
});

describe("leaveParty & lifecycle", () => {
  it("removes a member and reports empty", () => {
    let p = joinParty(base(), { clientId: "c1", nickname: "A", positions: ["MID"], now: NOW });
    p = leaveParty(p, "c1");
    expect(isEmpty(p)).toBe(true);
  });

  it("keeps ownership unchanged when a non-owner member leaves", () => {
    let p = joinParty(base(), { clientId: OWNER, nickname: "Owner", positions: ["MID"], now: NOW });
    p = joinParty(p, { clientId: "c2", nickname: "B", positions: ["TOP"], now: NOW });
    p = leaveParty(p, "c2");
    expect(p.ownerId).toBe(OWNER);
  });

  it("hands ownership to the earliest remaining member when the owner leaves", () => {
    let p = joinParty(base(), { clientId: OWNER, nickname: "Owner", positions: ["MID"], now: NOW });
    p = joinParty(p, { clientId: "c2", nickname: "B", positions: ["TOP"], now: NOW });
    p = joinParty(p, { clientId: "c3", nickname: "C", positions: ["ADC"], now: NOW });
    p = leaveParty(p, OWNER);
    expect(p.ownerId).toBe("c2");
  });

  it("isExpired only after the scheduled time", () => {
    const p = createParty("p", { queue: "SOLO", scheduledAt: FUTURE }, NOW, OWNER);
    expect(isExpired(p, NOW)).toBe(false);
    expect(isExpired(p, FUTURE)).toBe(true);
  });
});
