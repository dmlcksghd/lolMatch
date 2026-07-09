import { describe, it, expect } from "vitest";
import {
  createRoster,
  claim,
  release,
  releaseAllByOwner,
  filledCount,
  seatOf,
} from "../src/domain/roster";

const NOW = 1_700_000_000_000;

describe("createRoster", () => {
  it("starts with all five positions empty", () => {
    const r = createRoster();
    expect(filledCount(r)).toBe(0);
    expect(r.seats.TOP).toBeNull();
    expect(r.seats.SUP).toBeNull();
  });
});

describe("claim", () => {
  it("fills an empty position with the player", () => {
    const r = claim(createRoster(), { position: "MID", nickname: "유자생강차", ownerId: "s1", now: NOW });
    expect(r.seats.MID).toEqual({ position: "MID", nickname: "유자생강차", ownerId: "s1", claimedAt: NOW });
    expect(filledCount(r)).toBe(1);
  });

  it("does not mutate the previous state (immutability)", () => {
    const before = createRoster();
    claim(before, { position: "TOP", nickname: "방장", ownerId: "s1", now: NOW });
    expect(before.seats.TOP).toBeNull();
  });

  it("trims surrounding whitespace from the nickname", () => {
    const r = claim(createRoster(), { position: "TOP", nickname: "  용사지망생  ", ownerId: "s1", now: NOW });
    expect(r.seats.TOP?.nickname).toBe("용사지망생");
  });

  it("rejects a position already held by another player", () => {
    const r = claim(createRoster(), { position: "ADC", nickname: "A", ownerId: "s1", now: NOW });
    expect(() => claim(r, { position: "ADC", nickname: "B", ownerId: "s2", now: NOW })).toThrowError(
      expect.objectContaining({ code: "POSITION_TAKEN" }),
    );
  });

  it("moves a player who claims a new position (one seat per player)", () => {
    let r = claim(createRoster(), { position: "TOP", nickname: "이동", ownerId: "s1", now: NOW });
    r = claim(r, { position: "JGL", nickname: "이동", ownerId: "s1", now: NOW });
    expect(r.seats.TOP).toBeNull();
    expect(r.seats.JGL?.ownerId).toBe("s1");
    expect(filledCount(r)).toBe(1);
  });

  it("is idempotent when the same player re-claims their own seat", () => {
    const r1 = claim(createRoster(), { position: "SUP", nickname: "고정", ownerId: "s1", now: NOW });
    const r2 = claim(r1, { position: "SUP", nickname: "고정", ownerId: "s1", now: NOW });
    expect(filledCount(r2)).toBe(1);
    expect(r2.seats.SUP?.ownerId).toBe("s1");
  });

  it("rejects an unknown position", () => {
    expect(() =>
      claim(createRoster(), { position: "AAA" as never, nickname: "A", ownerId: "s1", now: NOW }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_POSITION" }));
  });

  it.each(["", "   ", "  \t "])("rejects a blank nickname (%j)", (bad) => {
    expect(() =>
      claim(createRoster(), { position: "MID", nickname: bad, ownerId: "s1", now: NOW }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_NICKNAME" }));
  });

  it("rejects a nickname longer than 16 characters", () => {
    expect(() =>
      claim(createRoster(), { position: "MID", nickname: "x".repeat(17), ownerId: "s1", now: NOW }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_NICKNAME" }));
  });
});

describe("release", () => {
  it("empties a seat the requester owns", () => {
    const r1 = claim(createRoster(), { position: "MID", nickname: "A", ownerId: "s1", now: NOW });
    const r2 = release(r1, { position: "MID", ownerId: "s1" });
    expect(r2.seats.MID).toBeNull();
    expect(filledCount(r2)).toBe(0);
  });

  it("rejects releasing a seat owned by someone else", () => {
    const r1 = claim(createRoster(), { position: "MID", nickname: "A", ownerId: "s1", now: NOW });
    expect(() => release(r1, { position: "MID", ownerId: "s2" })).toThrowError(
      expect.objectContaining({ code: "NOT_SEAT_OWNER" }),
    );
  });

  it("rejects releasing an empty seat", () => {
    expect(() => release(createRoster(), { position: "MID", ownerId: "s1" })).toThrowError(
      expect.objectContaining({ code: "SEAT_NOT_FOUND" }),
    );
  });

  it("does not mutate the previous state", () => {
    const r1 = claim(createRoster(), { position: "MID", nickname: "A", ownerId: "s1", now: NOW });
    release(r1, { position: "MID", ownerId: "s1" });
    expect(r1.seats.MID).not.toBeNull();
  });
});

describe("releaseAllByOwner", () => {
  it("frees the seat held by the given owner", () => {
    const r1 = claim(createRoster(), { position: "MID", nickname: "A", ownerId: "s1", now: NOW });
    expect(filledCount(releaseAllByOwner(r1, "s1"))).toBe(0);
  });

  it("leaves other players untouched", () => {
    let r = claim(createRoster(), { position: "MID", nickname: "A", ownerId: "s1", now: NOW });
    r = claim(r, { position: "TOP", nickname: "B", ownerId: "s2", now: NOW });
    const after = releaseAllByOwner(r, "s1");
    expect(after.seats.MID).toBeNull();
    expect(after.seats.TOP?.ownerId).toBe("s2");
  });

  it("is a no-op when the owner holds no seat", () => {
    const r = createRoster();
    expect(releaseAllByOwner(r, "ghost")).toBe(r);
  });
});

describe("seatOf", () => {
  it("returns the position a player holds, or null", () => {
    const r = claim(createRoster(), { position: "JGL", nickname: "A", ownerId: "s1", now: NOW });
    expect(seatOf(r, "s1")).toBe("JGL");
    expect(seatOf(r, "s2")).toBeNull();
  });
});

describe("nickname sanitization", () => {
  it("strips control and bidi-override characters", () => {
    const r = claim(createRoster(), { position: "MID", nickname: "abc‮def", ownerId: "s1", now: NOW });
    expect(r.seats.MID?.nickname).toBe("abcdef");
  });

  it("rejects a nickname that is only unsafe characters", () => {
    expect(() =>
      claim(createRoster(), { position: "MID", nickname: "​‮", ownerId: "s1", now: NOW }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_NICKNAME" }));
  });
});
