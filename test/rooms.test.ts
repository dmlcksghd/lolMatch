import { describe, it, expect } from "vitest";
import { RoomRegistry, DEFAULT_SETTINGS } from "../src/server/rooms";

const NOW = 1_700_000_000_000;

describe("RoomRegistry", () => {
  it("creates a room with default settings and an empty roster", () => {
    const reg = new RoomRegistry();
    const room = reg.getOrCreate("r1");
    expect(room.settings).toEqual(DEFAULT_SETTINGS);
    expect(reg.toDTO(room).filled).toBe(0);
  });

  it("returns the same room state on repeated access", () => {
    const reg = new RoomRegistry();
    reg.claim("r1", { position: "MID", nickname: "A", ownerId: "s1", now: NOW });
    expect(reg.get("r1")).toBe(reg.getOrCreate("r1"));
    expect(reg.toDTO(reg.getOrCreate("r1")).filled).toBe(1);
  });

  it("keeps rooms isolated from one another", () => {
    const reg = new RoomRegistry();
    reg.claim("a", { position: "TOP", nickname: "A", ownerId: "s1", now: NOW });
    expect(reg.toDTO(reg.getOrCreate("a")).filled).toBe(1);
    expect(reg.toDTO(reg.getOrCreate("b")).filled).toBe(0);
  });

  it("propagates domain errors (position taken)", () => {
    const reg = new RoomRegistry();
    reg.claim("r", { position: "ADC", nickname: "A", ownerId: "s1", now: NOW });
    expect(() => reg.claim("r", { position: "ADC", nickname: "B", ownerId: "s2", now: NOW })).toThrowError(
      expect.objectContaining({ code: "POSITION_TAKEN" }),
    );
  });

  it("releases a seat by owner on disconnect", () => {
    const reg = new RoomRegistry();
    reg.claim("r", { position: "SUP", nickname: "A", ownerId: "s1", now: NOW });
    reg.releaseOwner("r", "s1");
    expect(reg.toDTO(reg.getOrCreate("r")).filled).toBe(0);
  });

  it("merges partial settings updates", () => {
    const reg = new RoomRegistry();
    const room = reg.updateSettings("r", { time: "오후 8:30", tier: "골드·에메" });
    expect(room.settings.time).toBe("오후 8:30");
    expect(room.settings.queue).toBe(DEFAULT_SETTINGS.queue);
  });

  it("exposes a wire DTO with roomId, seats and filled count", () => {
    const reg = new RoomRegistry();
    reg.claim("r", { position: "JGL", nickname: "정글러", ownerId: "s1", now: NOW });
    const dto = reg.toDTO(reg.getOrCreate("r"));
    expect(dto.roomId).toBe("r");
    expect(dto.seats.JGL?.nickname).toBe("정글러");
    expect(dto.filled).toBe(1);
  });
});

describe("RoomRegistry eviction", () => {
  it("removes a room and reports size", () => {
    const reg = new RoomRegistry();
    reg.claim("r", { position: "MID", nickname: "A", ownerId: "s1", now: NOW });
    expect(reg.size()).toBe(1);
    reg.remove("r");
    expect(reg.size()).toBe(0);
    expect(reg.get("r")).toBeUndefined();
  });
});
