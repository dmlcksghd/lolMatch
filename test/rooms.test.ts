import { describe, it, expect } from "vitest";
import { RoomRegistry } from "../src/server/rooms";
import { DEFAULT_SETTINGS } from "../src/domain/game";

const NOW = 1_700_000_000_000;
const FUTURE = NOW + 3_600_000;

describe("RoomRegistry", () => {
  it("creates a room with default settings and game 1", () => {
    const reg = new RoomRegistry();
    const game = reg.getOrCreate("r1", NOW);
    expect(game.settings).toEqual(DEFAULT_SETTINGS);
    const dto = reg.toDTO("r1", game, NOW);
    expect(dto.filled).toBe(0);
    expect(dto.gameId).toBe(1);
  });

  it("persists a claimed seat (not tied to a connection)", () => {
    const reg = new RoomRegistry();
    reg.claim("r1", { position: "MID", nickname: "A", ownerId: "c1", now: NOW }, NOW);
    const dto = reg.toDTO("r1", reg.getOrCreate("r1", NOW), NOW);
    expect(dto.filled).toBe(1);
    expect(dto.seats.MID?.ownerId).toBe("c1");
  });

  it("keeps rooms isolated", () => {
    const reg = new RoomRegistry();
    reg.claim("a", { position: "TOP", nickname: "A", ownerId: "c1", now: NOW }, NOW);
    expect(reg.toDTO("a", reg.getOrCreate("a", NOW), NOW).filled).toBe(1);
    expect(reg.toDTO("b", reg.getOrCreate("b", NOW), NOW).filled).toBe(0);
  });

  it("propagates domain errors (position taken)", () => {
    const reg = new RoomRegistry();
    reg.claim("r", { position: "ADC", nickname: "A", ownerId: "c1", now: NOW }, NOW);
    expect(() =>
      reg.claim("r", { position: "ADC", nickname: "B", ownerId: "c2", now: NOW }, NOW),
    ).toThrowError(expect.objectContaining({ code: "POSITION_TAKEN" }));
  });

  it("releases a seat by its owner (clientId)", () => {
    const reg = new RoomRegistry();
    reg.claim("r", { position: "SUP", nickname: "A", ownerId: "c1", now: NOW }, NOW);
    reg.release("r", { position: "SUP", ownerId: "c1" }, NOW);
    expect(reg.toDTO("r", reg.getOrCreate("r", NOW), NOW).filled).toBe(0);
  });

  it("updates tier / queue / time settings", () => {
    const reg = new RoomRegistry();
    const game = reg.updateSettings("r", { tier: "GOLD", queue: "ARAM", scheduledAt: FUTURE }, NOW);
    expect(game.settings.tier).toBe("GOLD");
    expect(game.settings.queue).toBe("ARAM");
    expect(game.settings.scheduledAt).toBe(FUTURE);
  });

  it("opens a fresh game (gameId 2, empty) once the scheduled time passes", () => {
    const reg = new RoomRegistry();
    reg.updateSettings("r", { scheduledAt: FUTURE }, NOW);
    reg.claim("r", { position: "MID", nickname: "A", ownerId: "c1", now: NOW }, NOW);
    const dto = reg.toDTO("r", reg.getOrCreate("r", FUTURE + 1), FUTURE + 1);
    expect(dto.gameId).toBe(2);
    expect(dto.filled).toBe(0);
    expect(dto.settings.scheduledAt).toBeNull();
  });

  it("reports and removes pristine rooms", () => {
    const reg = new RoomRegistry();
    reg.getOrCreate("r", NOW);
    expect(reg.isPristineRoom("r")).toBe(true);
    reg.claim("r", { position: "TOP", nickname: "A", ownerId: "c1", now: NOW }, NOW);
    expect(reg.isPristineRoom("r")).toBe(false);
    reg.remove("r");
    expect(reg.size()).toBe(0);
  });
});
