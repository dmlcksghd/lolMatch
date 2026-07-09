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
    const dto = reg.roomDTO("r", NOW);
    expect(dto.parties).toHaveLength(1);
    expect(dto.parties[0]?.count).toBe(1);
    expect(dto.parties[0]?.members[0]?.clientId).toBe("c1");
    expect(dto.parties[0]?.members[0]?.positions).toEqual(["MID"]);
    expect(dto.parties[0]?.capacity).toBe(5);
  });

  it("holds multiple parties per room", () => {
    create();
    create("r", { clientId: "c2", positions: ["TOP"] });
    expect(reg.roomDTO("r", NOW).parties).toHaveLength(2);
  });

  it("joins with multiple lanes and caps at 5 people", () => {
    const p = create();
    for (const c of ["c2", "c3", "c4", "c5"]) {
      reg.join("r", p.id, { clientId: c, nickname: c, positions: ["MID", "TOP"], now: NOW }, NOW);
    }
    expect(reg.roomDTO("r", NOW).parties[0]?.count).toBe(5);
    expect(() =>
      reg.join("r", p.id, { clientId: "c6", nickname: "F", positions: ["MID"], now: NOW }, NOW),
    ).toThrowError(code("PARTY_FULL"));
  });

  it("removes the party and the empty room when the last member leaves", () => {
    const p = create();
    reg.leave("r", p.id, "c1", NOW);
    expect(reg.roomDTO("r", NOW).parties).toHaveLength(0);
    expect(reg.size()).toBe(0);
  });

  it("drops parties whose scheduled time has passed", () => {
    create("r", { settings: { queue: "SOLO", scheduledAt: NOW + HOUR } });
    expect(reg.roomDTO("r", NOW).parties).toHaveLength(1);
    expect(reg.roomDTO("r", NOW + HOUR).parties).toHaveLength(0);
  });

  it("throws PARTY_NOT_FOUND when joining a missing party", () => {
    expect(() =>
      reg.join("r", "nope", { clientId: "x", nickname: "X", positions: ["MID"], now: NOW }, NOW),
    ).toThrowError(code("PARTY_NOT_FOUND"));
  });

  it("clears member lanes when a party switches to ARAM", () => {
    const p = create();
    reg.updateSettings("r", p.id, { queue: "ARAM" }, NOW);
    expect(reg.roomDTO("r", NOW).parties[0]?.members[0]?.positions).toEqual([]);
  });
});
