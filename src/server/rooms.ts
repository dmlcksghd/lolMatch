import {
  createParty,
  joinParty,
  leaveParty,
  updateSettings,
  isExpired,
  MAX_PARTY,
  type Party,
  type SettingsPatch,
  type JoinInput,
} from "../domain/party";
import { DomainError } from "../domain/errors";

export interface MemberDTO {
  nickname: string;
  positions: string[];
  /** 보는 사람 자신의 멤버 항목인지. 다른 사람의 신원은 어떤 형태로도 DTO에 싣지 않는다 —
   *  같은 라인을 여러 명이 공유할 수 있어 "내 칩"을 정확히 가리키려면 항목별 표시가 필요하다. */
  mine: boolean;
}

export interface PartyDTO {
  id: string;
  settings: { tier: string; queue: string; scheduledAt: number | null };
  members: MemberDTO[];
  count: number;
  capacity: number;
  /** 보는 사람이 이 파티의 방장인지. 설정 편집 UI 노출 여부에 쓴다. */
  isOwner: boolean;
}

export interface RoomDTO {
  roomId: string;
  parties: PartyDTO[];
  now: number;
}

export interface CreateInput {
  clientId: string;
  nickname: string;
  positions?: unknown;
  settings?: SettingsPatch;
  now: number;
}

const MAX_PARTIES_PER_ROOM = 30;
const MAX_ROOMS = 500;

/** 방마다 파티 리스트를 들고 있는 인메모리 저장소. */
export class RoomRegistry {
  private readonly rooms = new Map<string, Party[]>();
  private seq = 0;

  private nextPartyId(): string {
    this.seq += 1;
    return `party-${this.seq}`;
  }

  /** 만료된 파티를 걷어낸 현재 리스트. 빈 방은 메모리에서 제거. */
  private live(roomId: string, now: number): Party[] {
    const list = this.rooms.get(roomId);
    if (!list) return [];
    const kept = list.filter((p) => !isExpired(p, now));
    if (kept.length !== list.length) {
      if (kept.length === 0) this.rooms.delete(roomId);
      else this.rooms.set(roomId, kept);
    }
    return kept;
  }

  parties(roomId: string, now: number): Party[] {
    return this.live(roomId, now);
  }

  createParty(roomId: string, input: CreateInput): Party {
    const list = this.live(roomId, input.now);
    if (list.length >= MAX_PARTIES_PER_ROOM) {
      throw new DomainError("PARTY_FULL", `방당 파티는 최대 ${MAX_PARTIES_PER_ROOM}개까지입니다.`);
    }
    if (!this.rooms.has(roomId) && this.rooms.size >= MAX_ROOMS) {
      throw new DomainError("PARTY_FULL", "동시 방 수 한도를 초과했습니다.");
    }
    const created = createParty(this.nextPartyId(), input.settings ?? {}, input.now, input.clientId);
    // 만든 사람이 첫 멤버로 들어간다(빈 파티가 리스트에 남지 않도록).
    const withCreator = joinParty(created, {
      clientId: input.clientId,
      nickname: input.nickname,
      positions: input.positions,
      now: input.now,
    });
    this.rooms.set(roomId, [...list, withCreator]);
    return withCreator;
  }

  join(roomId: string, partyId: string, input: JoinInput, now: number): Party {
    const list = this.live(roomId, now);
    const party = list.find((p) => p.id === partyId);
    if (!party) throw new DomainError("PARTY_NOT_FOUND", "파티를 찾을 수 없습니다.");
    const updated = joinParty(party, input);
    this.rooms.set(roomId, list.map((p) => (p.id === partyId ? updated : p)));
    return updated;
  }

  leave(roomId: string, partyId: string, clientId: string, now: number): void {
    const list = this.live(roomId, now);
    const party = list.find((p) => p.id === partyId);
    if (!party) return;
    const updated = leaveParty(party, clientId);
    const next =
      updated.members.length === 0
        ? list.filter((p) => p.id !== partyId)
        : list.map((p) => (p.id === partyId ? updated : p));
    if (next.length === 0) this.rooms.delete(roomId);
    else this.rooms.set(roomId, next);
  }

  /** 방장(ownerId)만 설정을 바꿀 수 있다. 큐 전환으로 파티가 비면(유령 인원 정리) 목록에서 제거한다. */
  updateSettings(roomId: string, partyId: string, callerId: string, patch: SettingsPatch, now: number): Party | null {
    const list = this.live(roomId, now);
    const party = list.find((p) => p.id === partyId);
    if (!party) throw new DomainError("PARTY_NOT_FOUND", "파티를 찾을 수 없습니다.");
    if (party.ownerId !== callerId) {
      throw new DomainError("NOT_OWNER", "방장만 설정을 바꿀 수 있습니다.");
    }
    const updated = updateSettings(party, patch, now);
    if (updated.members.length === 0) {
      const next = list.filter((p) => p.id !== partyId);
      if (next.length === 0) this.rooms.delete(roomId);
      else this.rooms.set(roomId, next);
      return null;
    }
    this.rooms.set(roomId, list.map((p) => (p.id === partyId ? updated : p)));
    return updated;
  }

  roomDTO(roomId: string, now: number, viewerId: string): RoomDTO {
    return { roomId, parties: this.live(roomId, now).map((p) => toPartyDTO(p, viewerId)), now };
  }

  size(): number {
    return this.rooms.size;
  }

  remove(roomId: string): void {
    this.rooms.delete(roomId);
  }

  /** 가장 이른 미래 예정 시각(만료 타이머용). 없으면 null. */
  nextExpiry(roomId: string, now: number): number | null {
    const times = this.live(roomId, now)
      .map((p) => p.settings.scheduledAt)
      .filter((t): t is number => t !== null && t > now);
    return times.length ? Math.min(...times) : null;
  }
}

function toMemberDTO(m: { clientId: string; nickname: string; positions: readonly string[] }, viewerId: string): MemberDTO {
  return { nickname: m.nickname, positions: [...m.positions], mine: m.clientId === viewerId };
}

function toPartyDTO(p: Party, viewerId: string): PartyDTO {
  return {
    id: p.id,
    settings: { tier: p.settings.tier, queue: p.settings.queue, scheduledAt: p.settings.scheduledAt },
    members: p.members.map((m) => toMemberDTO(m, viewerId)),
    count: p.members.length,
    capacity: MAX_PARTY,
    isOwner: p.ownerId === viewerId,
  };
}
