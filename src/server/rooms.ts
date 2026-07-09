import {
  claimSeat,
  createGame,
  expireIfDue,
  filled,
  isPristine,
  releaseOwnerSeat,
  releaseSeat,
  updateSettings as gameUpdateSettings,
  type Game,
  type GameSettings,
  type SettingsPatch,
} from "../domain/game";
import type { ClaimInput, ReleaseInput, RosterState } from "../domain/roster";

export interface GameDTO {
  roomId: string;
  gameId: number;
  settings: GameSettings;
  seats: RosterState["seats"];
  filled: number;
  now: number;
}

/**
 * 방(오픈채팅방 하나 = 방 하나)들의 현재 게임을 담는 인메모리 저장소.
 * 자리는 연결과 무관하게 **저장**되며(끊겨도 유지), 접근할 때 예정 시각이 지났으면 새 게임으로 교체한다.
 */
export class RoomRegistry {
  private readonly rooms = new Map<string, Game>();

  size(): number {
    return this.rooms.size;
  }

  remove(roomId: string): void {
    this.rooms.delete(roomId);
  }

  /** 현재 게임을 반환하되, 예정 시각이 지났으면 새 게임으로 교체(지연 만료). */
  private current(roomId: string, now: number): Game {
    const game = expireIfDue(this.rooms.get(roomId) ?? createGame(), now);
    this.rooms.set(roomId, game);
    return game;
  }

  getOrCreate(roomId: string, now: number): Game {
    return this.current(roomId, now);
  }

  claim(roomId: string, input: ClaimInput, now: number): Game {
    return this.replace(roomId, claimSeat(this.current(roomId, now), input));
  }

  release(roomId: string, input: ReleaseInput, now: number): Game {
    return this.replace(roomId, releaseSeat(this.current(roomId, now), input));
  }

  releaseOwner(roomId: string, ownerId: string, now: number): Game {
    return this.replace(roomId, releaseOwnerSeat(this.current(roomId, now), ownerId));
  }

  updateSettings(roomId: string, patch: SettingsPatch, now: number): Game {
    return this.replace(roomId, gameUpdateSettings(this.current(roomId, now), patch, now));
  }

  /** 아무도 손대지 않은 기본 방인지(연결 종료 시 정리 판단). */
  isPristineRoom(roomId: string): boolean {
    const game = this.rooms.get(roomId);
    return game ? isPristine(game) : true;
  }

  toDTO(roomId: string, game: Game, now: number): GameDTO {
    return {
      roomId,
      gameId: game.id,
      settings: game.settings,
      seats: game.roster.seats,
      filled: filled(game),
      now,
    };
  }

  private replace(roomId: string, game: Game): Game {
    this.rooms.set(roomId, game);
    return game;
  }
}
