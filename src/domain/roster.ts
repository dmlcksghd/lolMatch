import { DomainError } from "./errors";
import { isPosition, POSITIONS, type Position } from "./positions";

export const NICKNAME_MAX = 16;

/**
 * 제어문자 · 제로폭 · 양방향 오버라이드(스푸핑/레이아웃 파괴) 문자 제거용.
 * C0 컨트롤, DEL, zero-width/bidi 마크, bidi 임베딩/오버라이드/아이솔레이트.
 */
const UNSAFE_CHARS = new RegExp(
  "[" +
    "\\u0000-\\u001F" +
    "\\u007F" +
    "\\u200B-\\u200F" +
    "\\u202A-\\u202E" +
    "\\u2066-\\u2069" +
    "]",
  "g",
);

export interface Seat {
  position: Position;
  nickname: string;
  /** 자리를 차지한 세션(소켓) 식별자. 해제 권한 확인에 사용한다. */
  ownerId: string;
  claimedAt: number;
}

export type Seats = Record<Position, Seat | null>;

export interface RosterState {
  readonly seats: Readonly<Seats>;
}

export interface ClaimInput {
  position: Position;
  nickname: string;
  ownerId: string;
  now: number;
}

export interface ReleaseInput {
  position: Position;
  ownerId: string;
}

/** 모든 포지션이 빈 새 명단을 만든다. */
export function createRoster(): RosterState {
  const seats = {} as Seats;
  for (const position of POSITIONS) seats[position] = null;
  return { seats };
}

function normalizeNickname(raw: string): string {
  const cleaned = raw.replace(UNSAFE_CHARS, "").trim();
  if (cleaned.length < 1 || cleaned.length > NICKNAME_MAX) {
    throw new DomainError("INVALID_NICKNAME", `닉네임은 1~${NICKNAME_MAX}자여야 합니다.`);
  }
  return cleaned;
}

/** 해당 플레이어가 현재 앉아 있는 포지션(없으면 null). */
export function seatOf(state: RosterState, ownerId: string): Position | null {
  for (const position of POSITIONS) {
    if (state.seats[position]?.ownerId === ownerId) return position;
  }
  return null;
}

export function filledCount(state: RosterState): number {
  return POSITIONS.reduce((count, position) => (state.seats[position] ? count + 1 : count), 0);
}

/**
 * 플레이어가 한 포지션을 차지한다. 한 플레이어는 한 자리만 가질 수 있어,
 * 다른 자리에 앉아 있었다면 그 자리를 비우고 이동한다.
 */
export function claim(state: RosterState, input: ClaimInput): RosterState {
  if (!isPosition(input.position)) {
    throw new DomainError("INVALID_POSITION", `알 수 없는 포지션입니다: ${String(input.position)}`);
  }
  const nickname = normalizeNickname(input.nickname);

  const occupant = state.seats[input.position];
  if (occupant && occupant.ownerId !== input.ownerId) {
    throw new DomainError("POSITION_TAKEN", `${input.position} 자리는 이미 찼습니다.`);
  }

  const seats: Seats = { ...state.seats };
  const current = seatOf(state, input.ownerId);
  if (current) seats[current] = null;
  seats[input.position] = {
    position: input.position,
    nickname,
    ownerId: input.ownerId,
    claimedAt: input.now,
  };
  return { seats };
}

/** 본인이 앉은 자리만 비울 수 있다. */
export function release(state: RosterState, input: ReleaseInput): RosterState {
  if (!isPosition(input.position)) {
    throw new DomainError("INVALID_POSITION", `알 수 없는 포지션입니다: ${String(input.position)}`);
  }
  const occupant = state.seats[input.position];
  if (!occupant) {
    throw new DomainError("SEAT_NOT_FOUND", `${input.position} 자리는 비어 있습니다.`);
  }
  if (occupant.ownerId !== input.ownerId) {
    throw new DomainError("NOT_SEAT_OWNER", "본인이 앉은 자리만 비울 수 있습니다.");
  }
  const seats: Seats = { ...state.seats };
  seats[input.position] = null;
  return { seats };
}

/** 세션 종료(연결 끊김) 시, 그 세션이 잡고 있던 자리를 모두 비운다. */
export function releaseAllByOwner(state: RosterState, ownerId: string): RosterState {
  const current = seatOf(state, ownerId);
  if (!current) return state;
  const seats: Seats = { ...state.seats };
  seats[current] = null;
  return { seats };
}
