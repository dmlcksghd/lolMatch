import type { Server, Socket } from "socket.io";
import { DomainError } from "../domain/errors";
import { isPosition } from "../domain/positions";
import type { RoomRegistry } from "./rooms";

export interface GatewayOptions {
  /** 시간 주입(테스트에서 결정적으로 만들기 위함). */
  now?: () => number;
}

const MAX_TIMEOUT = 2_147_000_000; // setTimeout 상한(약 24.8일) 미만

export function registerRosterGateway(
  io: Server,
  registry: RoomRegistry,
  options: GatewayOptions = {},
): void {
  const now = options.now ?? (() => Date.now());
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const broadcast = (roomId: string): void => {
    const game = registry.getOrCreate(roomId, now());
    io.to(roomId).emit("state", registry.toDTO(roomId, game, now()));
  };

  // 예정 시각에 맞춰 자동으로 만료 → 새 게임을 접속자들에게 반영.
  const scheduleExpiry = (roomId: string): void => {
    const prev = timers.get(roomId);
    if (prev) clearTimeout(prev);
    timers.delete(roomId);
    const game = registry.getOrCreate(roomId, now()); // 지났으면 여기서 이미 교체됨
    const at = game.settings.scheduledAt;
    if (at === null) return;
    const delay = Math.min(at - now(), MAX_TIMEOUT);
    if (delay <= 0) return;
    const timer = setTimeout(() => {
      timers.delete(roomId);
      settle(roomId);
    }, delay);
    timer.unref?.();
    timers.set(roomId, timer);
  };

  const settle = (roomId: string): void => {
    broadcast(roomId);
    scheduleExpiry(roomId);
  };

  io.on("connection", (socket: Socket) => {
    let joinedRoom: string | null = null;

    socket.on("join", (payload: { roomId?: unknown }) => {
      const roomId = normalizeRoomId(payload?.roomId);
      if (!roomId) return emitError(socket, "INVALID_ROOM", "방 코드가 올바르지 않습니다.");
      if (joinedRoom && joinedRoom !== roomId) socket.leave(joinedRoom);
      joinedRoom = roomId;
      socket.join(roomId);
      const game = registry.getOrCreate(roomId, now());
      socket.emit("state", registry.toDTO(roomId, game, now()));
      scheduleExpiry(roomId);
    });

    socket.on("claim", (payload: { position?: unknown; nickname?: unknown; clientId?: unknown }) => {
      if (!joinedRoom) return emitError(socket, "NOT_JOINED", "먼저 방에 입장하세요.");
      const position = payload?.position;
      const clientId = normalizeClientId(payload?.clientId);
      if (!isPosition(position)) return emitError(socket, "INVALID_POSITION", "알 수 없는 포지션입니다.");
      if (!clientId) return emitError(socket, "NO_CLIENT", "클라이언트 식별자가 필요합니다.");
      try {
        registry.claim(
          joinedRoom,
          { position, nickname: String(payload?.nickname ?? ""), ownerId: clientId, now: now() },
          now(),
        );
        settle(joinedRoom);
      } catch (err) {
        handle(socket, err);
      }
    });

    socket.on("release", (payload: { position?: unknown; clientId?: unknown }) => {
      if (!joinedRoom) return emitError(socket, "NOT_JOINED", "먼저 방에 입장하세요.");
      const position = payload?.position;
      const clientId = normalizeClientId(payload?.clientId);
      if (!isPosition(position)) return emitError(socket, "INVALID_POSITION", "알 수 없는 포지션입니다.");
      if (!clientId) return emitError(socket, "NO_CLIENT", "클라이언트 식별자가 필요합니다.");
      try {
        registry.release(joinedRoom, { position, ownerId: clientId }, now());
        settle(joinedRoom);
      } catch (err) {
        handle(socket, err);
      }
    });

    socket.on(
      "settings:update",
      (payload: { tier?: unknown; queue?: unknown; scheduledAt?: unknown; clientId?: unknown }) => {
        if (!joinedRoom) return emitError(socket, "NOT_JOINED", "먼저 방에 입장하세요.");
        if (!normalizeClientId(payload?.clientId)) {
          return emitError(socket, "NO_CLIENT", "클라이언트 식별자가 필요합니다.");
        }
        try {
          registry.updateSettings(
            joinedRoom,
            { tier: payload?.tier, queue: payload?.queue, scheduledAt: payload?.scheduledAt },
            now(),
          );
          settle(joinedRoom);
        } catch (err) {
          handle(socket, err);
        }
      },
    );

    socket.on("disconnect", () => {
      if (!joinedRoom) return;
      // 자리는 연결 종료로 풀리지 않는다(저장 유지). 아무도 안 쓴 기본 방만 정리.
      if (registry.isPristineRoom(joinedRoom)) {
        const timer = timers.get(joinedRoom);
        if (timer) clearTimeout(timer);
        timers.delete(joinedRoom);
        registry.remove(joinedRoom);
      }
    });
  });
}

function normalizeRoomId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 64 ? trimmed : null;
}

function normalizeClientId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 64 ? trimmed : null;
}

function handle(socket: Socket, err: unknown): void {
  if (err instanceof DomainError) {
    emitError(socket, err.code, err.message);
    return;
  }
  console.error("[socket] unexpected error", err);
  emitError(socket, "INTERNAL", "알 수 없는 오류가 발생했습니다.");
}

function emitError(socket: Socket, code: string, message: string): void {
  socket.emit("roster:error", { code, message });
}
