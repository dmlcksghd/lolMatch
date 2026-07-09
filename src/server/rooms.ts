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
  clientId: string;
  nickname: string;
  positions: string[];
}

export interface PartyDTO {
  id: string;
  settings: { tier: string; queue: string; scheduledAt: number | null };
  members: MemberDTO[];
  count: number;
  capacity: number;
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
    const created = createParty(this.nextPartyId(), input.settings ?? {}, input.now);
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

  updateSettings(roomId: string, partyId: string, patch: SettingsPatch, now: number): Party {
    const list = this.live(roomId, now);
    const party = list.find((p) => p.id === partyId);
    if (!party) throw new DomainError("PARTY_NOT_FOUND", "파티를 찾을 수 없습니다.");
    const updated = updateSettings(party, patch, now);
    this.rooms.set(roomId, list.map((p) => (p.id === partyId ? updated : p)));
    return updated;
  }

  roomDTO(roomId: string, now: number): RoomDTO {
    return { roomId, parties: this.live(roomId, now).map(toPartyDTO), now };
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

function toPartyDTO(p: Party): PartyDTO {
  return {
    id: p.id,
    settings: { tier: p.settings.tier, queue: p.settings.queue, scheduledAt: p.settings.scheduledAt },
    members: p.members.map((m) => ({ clientId: m.clientId, nickname: m.nickname, positions: m.positions })),
    count: p.members.length,
    capacity: MAX_PARTY,
  };
}
