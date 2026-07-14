import { describe, it, expect, beforeEach } from "vitest";
import { RoomRegistry } from "../src/server/rooms";

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;
const code = (c: string) => expect.objectContaining({ code: c });

describe("RoomRegistry (party list)", () => {
  let reg: RoomRegistry;
  beforeEach(() => {
    reg = new RoomRegistry();
  });

  const create = (room = "r", over: Record<string, unknown> = {}) =>
    reg.createParty(room, {
      clientId: "c1",
      nickname: "A",
      positions: ["MID"],
      settings: { queue: "SOLO" },
      now: NOW,
      ...over,
    });

  it("creates a party with the creator as first member", () => {
    create();
    const dto = reg.roomDTO("r", NOW, "c1");
    expect(dto.parties).toHaveLength(1);
    expect(dto.parties[0]?.count).toBe(1);
    expect(dto.parties[0]?.members[0]?.mine).toBe(true);
    expect(dto.parties[0]?.members[0]?.positions).toEqual(["MID"]);
    expect(dto.parties[0]?.capacity).toBe(5);
  });

  it("never exposes another viewer's identity — only nickname/positions and a personal mine flag", () => {
    create();
    const asStranger = reg.roomDTO("r", NOW, "someone-else");
    const member = asStranger.parties[0]?.members[0];
    expect(member).toEqual({ nickname: "A", positions: ["MID"], mine: false });
    expect(Object.keys(member ?? {})).not.toContain("clientId");
  });

  it("holds multiple parties per room", () => {
    create();
    create("r", { clientId: "c2", positions: ["TOP"] });
    expect(reg.roomDTO("r", NOW, "c1").parties).toHaveLength(2);
  });

  it("joins with multiple lanes and caps at 5 people", () => {
    const p = create();
    for (const c of ["c2", "c3", "c4", "c5"]) {
      reg.join("r", p.id, { clientId: c, nickname: c, positions: ["MID", "TOP"], now: NOW }, NOW);
    }
    expect(reg.roomDTO("r", NOW, "c1").parties[0]?.count).toBe(5);
    expect(() =>
      reg.join("r", p.id, { clientId: "c6", nickname: "F", positions: ["MID"], now: NOW }, NOW),
    ).toThrowError(code("PARTY_FULL"));
  });

  it("removes the party and the empty room when the last member leaves", () => {
    const p = create();
    reg.leave("r", p.id, "c1", NOW);
    expect(reg.roomDTO("r", NOW, "c1").parties).toHaveLength(0);
    expect(reg.size()).toBe(0);
  });

  it("drops parties whose scheduled time has passed", () => {
    create("r", { settings: { queue: "SOLO", scheduledAt: NOW + HOUR } });
    expect(reg.roomDTO("r", NOW, "c1").parties).toHaveLength(1);
    expect(reg.roomDTO("r", NOW + HOUR, "c1").parties).toHaveLength(0);
  });

  it("throws PARTY_NOT_FOUND when joining a missing party", () => {
    expect(() =>
      reg.join("r", "nope", { clientId: "x", nickname: "X", positions: ["MID"], now: NOW }, NOW),
    ).toThrowError(code("PARTY_NOT_FOUND"));
  });

  describe("updateSettings — owner-only", () => {
    it("clears member lanes when the owner switches the party to ARAM", () => {
      const p = create();
      reg.updateSettings("r", p.id, "c1", { queue: "ARAM" }, NOW);
      expect(reg.roomDTO("r", NOW, "c1").parties[0]?.members[0]?.positions).toEqual([]);
    });

    it("reports the creator as isOwner and everyone else as not", () => {
      const p = create();
      reg.join("r", p.id, { clientId: "c2", nickname: "B", positions: ["TOP"], now: NOW }, NOW);
      expect(reg.roomDTO("r", NOW, "c1").parties[0]?.isOwner).toBe(true);
      expect(reg.roomDTO("r", NOW, "c2").parties[0]?.isOwner).toBe(false);
    });

    it("rejects settings changes from anyone but the owner", () => {
      const p = create();
      reg.join("r", p.id, { clientId: "c2", nickname: "B", positions: ["TOP"], now: NOW }, NOW);
      expect(() => reg.updateSettings("r", p.id, "c2", { queue: "ARAM" }, NOW)).toThrowError(code("NOT_OWNER"));
      // 거부됐으니 설정은 그대로 바뀌지 않아야 함
      expect(reg.roomDTO("r", NOW, "c1").parties[0]?.settings.queue).toBe("SOLO");
    });

    it("throws NOT_OWNER even for a non-member stranger (not just other members)", () => {
      const p = create();
      expect(() => reg.updateSettings("r", p.id, "someone-else", { queue: "ARAM" }, NOW)).toThrowError(
        code("NOT_OWNER"),
      );
    });

    it("removes the party once a queue transition drops every ghost member", () => {
      const p = create("r", { settings: { queue: "ARAM" } });
      const updated = reg.updateSettings("r", p.id, "c1", { queue: "SOLO" }, NOW);
      expect(updated).toBeNull();
      expect(reg.roomDTO("r", NOW, "c1").parties).toHaveLength(0);
      expect(reg.size()).toBe(0);
    });

    it("removes only the emptied party, keeping the room's other parties intact", () => {
      const p = create("r", { settings: { queue: "ARAM" } });
      create("r", { clientId: "other", positions: ["TOP"] });
      const updated = reg.updateSettings("r", p.id, "c1", { queue: "SOLO" }, NOW);
      expect(updated).toBeNull();
      expect(reg.roomDTO("r", NOW, "other").parties).toHaveLength(1);
      expect(reg.size()).toBe(1);
    });
  });

  describe("capacity limits", () => {
    it("throws PARTY_FULL once a room already has the max number of parties", () => {
      for (let i = 0; i < 30; i++) create("r", { clientId: `owner-${i}` });
      expect(() => create("r", { clientId: "one-too-many" })).toThrowError(code("PARTY_FULL"));
    });

    it("throws PARTY_FULL once the number of distinct rooms hits the global cap", () => {
      for (let i = 0; i < 500; i++) create(`room-${i}`);
      expect(() => create("room-over-cap")).toThrowError(code("PARTY_FULL"));
    });

    it("allows omitting settings entirely on create (defaults apply)", () => {
      const p = reg.createParty("r", { clientId: "c1", nickname: "A", positions: ["MID"], now: NOW });
      expect(reg.roomDTO("r", NOW, "c1").parties[0]?.settings.queue).toBe("SOLO");
    });
  });

  describe("expiry cleanup", () => {
    it("keeps still-live parties when only some in the room expire", () => {
      create("r", { clientId: "keeps-going" });
      create("r", { clientId: "expires-soon", settings: { queue: "SOLO", scheduledAt: NOW + HOUR } });
      const dto = reg.roomDTO("r", NOW + HOUR, "keeps-going");
      expect(dto.parties).toHaveLength(1);
      expect(reg.size()).toBe(1);
    });
  });
});
