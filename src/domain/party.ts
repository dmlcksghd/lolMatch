import { DomainError } from "./errors";
import { POSITIONS, isPosition, type Position } from "./positions";
import { isQueue, type Queue } from "./queues";
import { isTier, type Tier } from "./tiers";

/** 파티 정원(총 인원 = 서로 다른 사람 수). 한 사람이 여러 라인 선택 가능. */
export const MAX_PARTY = 5;
export const NICKNAME_MAX = 16;
/** 예정 시각 상한(약 1년) — 6자리 연도 같은 비정상 입력 차단. */
const MAX_FUTURE_MS = 366 * 24 * 60 * 60 * 1000;

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
  /** 선택한 라인들(중복 없음, 여러 개 가능). ARAM 등 포지션 없는 큐에서는 빈 배열. */
  positions: Position[];
  joinedAt: number;
}

export interface Party {
  id: string;
  settings: PartySettings;
  members: Member[];
  createdAt: number;
  /** 방장(만든 사람) 신원. 설정 편집 권한을 이 값으로 제한한다. */
  ownerId: string;
}

export interface SettingsPatch {
  tier?: unknown;
  queue?: unknown;
  scheduledAt?: unknown;
}

export interface JoinInput {
  clientId: string;
  nickname: string;
  positions?: unknown;
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
  if (value > now + MAX_FUTURE_MS) {
    throw new DomainError("INVALID_TIME", "너무 먼 시각입니다.");
  }
  return value;
}

/** 라인 배열을 검증·중복제거하고 표준 순서로 정렬. 최소 1개 필요. */
function normalizePositions(value: unknown): Position[] {
  if (!Array.isArray(value)) throw new DomainError("INVALID_POSITION", "라인을 선택하세요.");
  const chosen: Position[] = [];
  for (const p of value) {
    if (!isPosition(p)) throw new DomainError("INVALID_POSITION", "알 수 없는 라인입니다.");
    if (!chosen.includes(p)) chosen.push(p);
  }
  if (chosen.length === 0) throw new DomainError("INVALID_POSITION", "라인을 하나 이상 선택하세요.");
  return POSITIONS.filter((p) => chosen.includes(p));
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

export function createParty(id: string, patch: SettingsPatch, now: number, ownerId: string): Party {
  return { id, settings: resolveSettings(patch, DEFAULT_SETTINGS, now), members: [], createdAt: now, ownerId };
}

/** 남은 멤버 중 가장 먼저 들어온 사람(= members[0], 가입 순서 유지)에게 방장을 넘긴다. */
function reassignOwner(members: Member[], currentOwnerId: string): string {
  if (members.some((m) => m.clientId === currentOwnerId)) return currentOwnerId;
  return members[0]?.clientId ?? currentOwnerId;
}

export function updateSettings(party: Party, patch: SettingsPatch, now: number): Party {
  const settings = resolveSettings(patch, party.settings, now);
  // 포지션이 없는 큐(칼바람)로 바꾸면 기존 멤버의 라인 선택을 모두 비운다.
  // 반대로 포지션 있는 큐로 바꾸면, 라인이 없는 멤버(칼바람에서 넘어온 사람)는 보이지 않는
  // 유령 인원으로 정원만 차지하게 되므로 파티에서 내보낸다(다시 라인 선택 후 참가해야 함).
  const members = usesPositions(settings.queue)
    ? party.members.filter((m) => m.positions.length > 0)
    : party.members.map((m) => (m.positions.length ? { ...m, positions: [] } : m));
  const ownerId = reassignOwner(members, party.ownerId);
  return { ...party, settings, members, ownerId };
}

export function joinParty(party: Party, input: JoinInput): Party {
  const nickname = normalizeNickname(input.nickname);
  const positions = usesPositions(party.settings.queue) ? normalizePositions(input.positions) : [];

  const idx = party.members.findIndex((m) => m.clientId === input.clientId);
  if (idx >= 0) {
    // 이미 참가한 사람: 닉네임·라인을 통째로 새 선택으로 교체(이름 바꾸면 선택도 갱신됨).
    const members = party.members.map((m, i) => (i === idx ? { ...m, nickname, positions } : m));
    return { ...party, members };
  }

  if (party.members.length >= MAX_PARTY) {
    throw new DomainError("PARTY_FULL", `파티가 가득 찼습니다(최대 ${MAX_PARTY}명).`);
  }
  const member: Member = { clientId: input.clientId, nickname, positions, joinedAt: input.now };
  return { ...party, members: [...party.members, member] };
}

export function leaveParty(party: Party, clientId: string): Party {
  const members = party.members.filter((m) => m.clientId !== clientId);
  const ownerId = reassignOwner(members, party.ownerId);
  return { ...party, members, ownerId };
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
