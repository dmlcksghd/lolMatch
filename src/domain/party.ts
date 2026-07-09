import { DomainError } from "./errors";
import { isPosition, type Position } from "./positions";
import { isQueue, type Queue } from "./queues";
import { isTier, type Tier } from "./tiers";

/** 파티 정원(총 인원, 포지션 중복 허용). */
export const MAX_PARTY = 5;
export const NICKNAME_MAX = 16;

// 제로폭/양방향/제어 문자 제거(닉네임 위장 방지). ASCII 소스로 구성.
const UNSAFE_CHARS = new RegExp(
  "[" + "\\u0000-\\u001F" + "\\u007F" + "\\u200B-\\u200F" + "\\u202A-\\u202E" + "\\u2066-\\u2069" + "]",
  "g",
);

export interface PartySettings {
  tier: Tier;
  queue: Queue;
  scheduledAt: number | null;
}

export interface Member {
  clientId: string;
  nickname: string;
  /** ARAM 등 포지션이 없는 큐에서는 null. */
  position: Position | null;
  joinedAt: number;
}

export interface Party {
  id: string;
  settings: PartySettings;
  members: Member[];
  createdAt: number;
}

export interface SettingsPatch {
  tier?: unknown;
  queue?: unknown;
  scheduledAt?: unknown;
}

export interface JoinInput {
  clientId: string;
  nickname: string;
  position?: unknown;
  now: number;
}

export const DEFAULT_SETTINGS: PartySettings = { tier: "ANY", queue: "SOLO", scheduledAt: null };

/** 칼바람(ARAM)은 라인이 없어 포지션을 쓰지 않는다. */
export function usesPositions(queue: Queue): boolean {
  return queue !== "ARAM";
}

function normalizeNickname(raw: string): string {
  const cleaned = raw.replace(UNSAFE_CHARS, "").trim();
  if (cleaned.length < 1 || cleaned.length > NICKNAME_MAX) {
    throw new DomainError("INVALID_NICKNAME", `닉네임은 1~${NICKNAME_MAX}자여야 합니다.`);
  }
  return cleaned;
}

function normalizeScheduledAt(value: unknown, now: number): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DomainError("INVALID_TIME", "시간 형식이 올바르지 않습니다.");
  }
  if (value <= now) {
    throw new DomainError("INVALID_TIME", "미래 시각을 선택하세요.");
  }
  return value;
}

function resolveSettings(patch: SettingsPatch, base: PartySettings, now: number): PartySettings {
  const settings: PartySettings = { ...base };
  if (patch.queue !== undefined) {
    if (!isQueue(patch.queue)) throw new DomainError("INVALID_QUEUE", "알 수 없는 큐입니다.");
    settings.queue = patch.queue;
  }
  if (patch.tier !== undefined) {
    if (!isTier(patch.tier)) throw new DomainError("INVALID_TIER", "알 수 없는 티어입니다.");
    settings.tier = patch.tier;
  }
  if (patch.scheduledAt !== undefined) {
    settings.scheduledAt = normalizeScheduledAt(patch.scheduledAt, now);
  }
  return settings;
}

export function createParty(id: string, patch: SettingsPatch, now: number): Party {
  return { id, settings: resolveSettings(patch, DEFAULT_SETTINGS, now), members: [], createdAt: now };
}

export function updateSettings(party: Party, patch: SettingsPatch, now: number): Party {
  const settings = resolveSettings(patch, party.settings, now);
  // 포지션이 없는 큐(칼바람)로 바꾸면 기존 멤버의 포지션을 모두 비운다.
  const members = usesPositions(settings.queue)
    ? party.members
    : party.members.map((m) => (m.position === null ? m : { ...m, position: null }));
  return { ...party, settings, members };
}

export function joinParty(party: Party, input: JoinInput): Party {
  const nickname = normalizeNickname(input.nickname);
  let position: Position | null;
  if (usesPositions(party.settings.queue)) {
    if (!isPosition(input.position)) throw new DomainError("INVALID_POSITION", "포지션을 선택하세요.");
    position = input.position;
  } else {
    position = null;
  }

  const idx = party.members.findIndex((m) => m.clientId === input.clientId);
  if (idx >= 0) {
    // 이미 참가한 사람: 포지션/닉네임만 갱신(정원 미소비).
    const members = party.members.map((m, i) => (i === idx ? { ...m, nickname, position } : m));
    return { ...party, members };
  }

  if (party.members.length >= MAX_PARTY) {
    throw new DomainError("PARTY_FULL", `파티가 가득 찼습니다(최대 ${MAX_PARTY}명).`);
  }
  const member: Member = { clientId: input.clientId, nickname, position, joinedAt: input.now };
  return { ...party, members: [...party.members, member] };
}

export function leaveParty(party: Party, clientId: string): Party {
  return { ...party, members: party.members.filter((m) => m.clientId !== clientId) };
}

export function memberCount(party: Party): number {
  return party.members.length;
}

export function isEmpty(party: Party): boolean {
  return party.members.length === 0;
}

export function isExpired(party: Party, now: number): boolean {
  return party.settings.scheduledAt !== null && now >= party.settings.scheduledAt;
}
