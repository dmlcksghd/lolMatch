import type { Server, Socket } from "socket.io";
import { DomainError } from "../domain/errors";
import { isPosition } from "../domain/positions";
import { filledCount } from "../domain/roster";
import type { Room, RoomRegistry } from "./rooms";

export interface GatewayOptions {
  /** 시간 주입(테스트에서 결정적으로 만들기 위함). */
  now?: () => number;
}

interface ClaimPayload {
  position?: unknown;
  nickname?: unknown;
}
interface JoinPayload {
  roomId?: unknown;
}
interface ReleasePayload {
  position?: unknown;
}

/**
 * Socket.IO 서버에 실시간 명단 이벤트를 연결한다.
 * 이벤트: join / claim / release  →  방 전체에 `state` 브로드캐스트.
 */
export function registerRosterGateway(
  io: Server,
  registry: RoomRegistry,
  options: GatewayOptions = {},
): void {
  const now = options.now ?? (() => Date.now());

  io.on("connection", (socket: Socket) => {
    let joinedRoom: string | null = null;

    // 방 상태를 방 전체에 알리고, 자리가 모두 비면 방을 회수(메모리 누수 방지).
    const broadcastAndReap = (roomId: string, room: Room): void => {
      io.to(roomId).emit("state", registry.toDTO(room));
      if (filledCount(room.roster) === 0) registry.remove(roomId);
    };

    socket.on("join", (payload: JoinPayload) => {
      const roomId = normalizeRoomId(payload?.roomId);
      if (!roomId) return emitError(socket, "INVALID_ROOM", "방 코드가 올바르지 않습니다.");

      // 다른 방으로 이동하는 경우, 이전 방에서 잡고 있던 자리를 반납한다.
      if (joinedRoom && joinedRoom !== roomId) {
        const previous = registry.releaseOwner(joinedRoom, socket.id);
        socket.leave(joinedRoom);
        broadcastAndReap(joinedRoom, previous);
      }

      joinedRoom = roomId;
      socket.join(roomId);
      socket.emit("state", registry.toDTO(registry.getOrCreate(roomId)));
    });

    socket.on("claim", (payload: ClaimPayload) => {
      if (!joinedRoom) return emitError(socket, "NOT_JOINED", "먼저 방에 입장하세요.");
      const position = payload?.position;
      if (!isPosition(position)) return emitError(socket, "INVALID_POSITION", "알 수 없는 포지션입니다.");
      try {
        const room = registry.claim(joinedRoom, {
          position,
          nickname: String(payload?.nickname ?? ""),
          ownerId: socket.id,
          now: now(),
        });
        io.to(joinedRoom).emit("state", registry.toDTO(room));
      } catch (err) {
        handle(socket, err);
      }
    });

    socket.on("release", (payload: ReleasePayload) => {
      if (!joinedRoom) return emitError(socket, "NOT_JOINED", "먼저 방에 입장하세요.");
      const position = payload?.position;
      if (!isPosition(position)) return emitError(socket, "INVALID_POSITION", "알 수 없는 포지션입니다.");
      try {
        const room = registry.release(joinedRoom, { position, ownerId: socket.id });
        broadcastAndReap(joinedRoom, room);
      } catch (err) {
        handle(socket, err);
      }
    });

    socket.on("disconnect", () => {
      if (!joinedRoom) return;
      broadcastAndReap(joinedRoom, registry.releaseOwner(joinedRoom, socket.id));
    });
  });
}

function normalizeRoomId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 64 ? trimmed : null;
}

function handle(socket: Socket, err: unknown): void {
  if (err instanceof DomainError) {
    emitError(socket, err.code, err.message);
    return;
  }
  // 예상치 못한 오류는 서버에 남겨 진단 가능하게 한다.
  console.error("[socket] unexpected error", err);
  emitError(socket, "INTERNAL", "알 수 없는 오류가 발생했습니다.");
}

function emitError(socket: Socket, code: string, message: string): void {
  socket.emit("roster:error", { code, message });
}
