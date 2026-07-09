import {
  claim as claimSeat,
  createRoster,
  filledCount,
  release as releaseSeat,
  releaseAllByOwner,
  type ClaimInput,
  type ReleaseInput,
  type RosterState,
} from "../domain/roster";

export interface RoomSettings {
  title: string;
  time: string;
  tier: string;
  queue: string;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  title: "랭크 5인 모집",
  time: "",
  tier: "",
  queue: "솔랭 / 자유랭",
};

export interface Room {
  id: string;
  settings: RoomSettings;
  roster: RosterState;
}

export interface RoomDTO {
  roomId: string;
  settings: RoomSettings;
  seats: RosterState["seats"];
  filled: number;
}

/**
 * 방(오픈채팅방 하나 = 방 하나)들의 현재 상태를 담는 인메모리 저장소.
 * roster 값 자체는 불변이며, 각 연산은 새 roster로 교체한다.
 */
export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();

  getOrCreate(roomId: string): Room {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;
    const room: Room = { id: roomId, settings: { ...DEFAULT_SETTINGS }, roster: createRoster() };
    this.rooms.set(roomId, room);
    return room;
  }

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /** 현재 존재하는 방 개수(메모리 상한 모니터링·테스트용). */
  size(): number {
    return this.rooms.size;
  }

  /** 빈 방을 저장소에서 제거해 메모리 누수를 막는다. */
  remove(roomId: string): void {
    this.rooms.delete(roomId);
  }

  claim(roomId: string, input: ClaimInput): Room {
    const room = this.getOrCreate(roomId);
    return this.replace({ ...room, roster: claimSeat(room.roster, input) });
  }

  release(roomId: string, input: ReleaseInput): Room {
    const room = this.getOrCreate(roomId);
    return this.replace({ ...room, roster: releaseSeat(room.roster, input) });
  }

  releaseOwner(roomId: string, ownerId: string): Room {
    const room = this.getOrCreate(roomId);
    return this.replace({ ...room, roster: releaseAllByOwner(room.roster, ownerId) });
  }

  updateSettings(roomId: string, partial: Partial<RoomSettings>): Room {
    const room = this.getOrCreate(roomId);
    return this.replace({ ...room, settings: { ...room.settings, ...partial } });
  }

  toDTO(room: Room): RoomDTO {
    return {
      roomId: room.id,
      settings: room.settings,
      seats: room.roster.seats,
      filled: filledCount(room.roster),
    };
  }

  private replace(room: Room): Room {
    this.rooms.set(room.id, room);
    return room;
  }
}
