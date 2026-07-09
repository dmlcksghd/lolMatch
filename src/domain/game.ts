import { DomainError } from "./errors";
import { isQueue, type Queue } from "./queues";
import { isTier, type Tier } from "./tiers";
import {
  claim as rosterClaim,
  createRoster,
  filledCount,
  release as rosterRelease,
  releaseAllByOwner as rosterReleaseOwner,
  type ClaimInput,
  type ReleaseInput,
  type RosterState,
} from "./roster";

export interface GameSettings {
  tier: Tier;
  queue: Queue;
  /** 예정 시각(epoch ms). null이면 시간 미정(만료 없음). */
  scheduledAt: number | null;
}

export interface Game {
  /** 방 안에서 몇 번째 게임인지. 만료 시마다 증가. */
  id: number;
  settings: GameSettings;
  roster: RosterState;
}

export const DEFAULT_SETTINGS: GameSettings = {
  tier: "ANY",
  queue: "SOLO",
  scheduledAt: null,
};

export interface SettingsPatch {
  tier?: unknown;
  queue?: unknown;
  scheduledAt?: unknown;
}

export function createGame(): Game {
  return { id: 1, settings: { ...DEFAULT_SETTINGS }, roster: createRoster() };
}

export function filled(game: Game): number {
  return filledCount(game.roster);
}

/** 시간·티어·큐 수정. 예정 시각은 미래여야 한다(null이면 시간 해제). */
export function updateSettings(game: Game, patch: SettingsPatch, now: number): Game {
  const settings: GameSettings = { ...game.settings };

  if (patch.tier !== undefined) {
    if (!isTier(patch.tier)) throw new DomainError("INVALID_TIER", "알 수 없는 티어입니다.");
    settings.tier = patch.tier;
  }
  if (patch.queue !== undefined) {
    if (!isQueue(patch.queue)) throw new DomainError("INVALID_QUEUE", "알 수 없는 큐입니다.");
    settings.queue = patch.queue;
  }
  if (patch.scheduledAt !== undefined) {
    settings.scheduledAt = normalizeScheduledAt(patch.scheduledAt, now);
  }

  return { ...game, settings };
}

function normalizeScheduledAt(value: unknown, now: number): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DomainError("INVALID_TIME", "시간 형식이 올바르지 않습니다.");
  }
  if (value <= now) {
    throw new DomainError("INVALID_TIME", "미래 시각을 선택하세요.");
  }
  return value;
}

export function isExpired(game: Game, now: number): boolean {
  return game.settings.scheduledAt !== null && now >= game.settings.scheduledAt;
}

/**
 * 예정 시각이 지났으면 새 게임을 연다: id+1, 빈 명단, 시간 해제(티어·큐는 유지).
 * 아직 안 지났으면 동일 게임을 그대로 반환.
 */
export function expireIfDue(game: Game, now: number): Game {
  if (!isExpired(game, now)) return game;
  return {
    id: game.id + 1,
    settings: { ...game.settings, scheduledAt: null },
    roster: createRoster(),
  };
}

export function claimSeat(game: Game, input: ClaimInput): Game {
  return { ...game, roster: rosterClaim(game.roster, input) };
}

export function releaseSeat(game: Game, input: ReleaseInput): Game {
  return { ...game, roster: rosterRelease(game.roster, input) };
}

export function releaseOwnerSeat(game: Game, ownerId: string): Game {
  return { ...game, roster: rosterReleaseOwner(game.roster, ownerId) };
}

/** 아무도 손대지 않은 기본 상태의 게임인지(방 정리 판단용). */
export function isPristine(game: Game): boolean {
  return (
    game.id === 1 &&
    filled(game) === 0 &&
    game.settings.scheduledAt === null &&
    game.settings.tier === DEFAULT_SETTINGS.tier &&
    game.settings.queue === DEFAULT_SETTINGS.queue
  );
}
