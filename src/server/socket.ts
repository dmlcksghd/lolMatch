import type { Server, Socket } from "socket.io";
import { DomainError } from "../domain/errors";
import type { RoomRegistry } from "./rooms";

export interface GatewayOptions {
  now?: () => number;
}

// setTimeout 상한(32비트) 근처. 그 이상은 상한으로 클램프.
const MAX_TIMEOUT = 2_147_000_000;

function normalizeRoomId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 64 ? trimmed : null;
}

function normalizeClientId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 100 ? trimmed : null;
}

function normalizePartyId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 64 ? trimmed : null;
}

export function registerRosterGateway(io: Server, registry: RoomRegistry, options: GatewayOptions = {}): void {
  const clock = options.now ?? (() => Date.now());
  const timers = new Map<string, NodeJS.Timeout>();

  function sendErr(socket: Socket, code: string, message: string): void {
    socket.emit("party:error", { code, message });
  }

  function fail(socket: Socket, error: unknown): void {
    if (error instanceof DomainError) sendErr(socket, error.code, error.message);
    else sendErr(socket, "INTERNAL", "요청을 처리하지 못했습니다.");
  }

  function scheduleExpiry(roomId: string): void {
    const existing = timers.get(roomId);
    if (existing) {
      clearTimeout(existing);
      timers.delete(roomId);
    }
    const now = clock();
    const at = registry.nextExpiry(roomId, now);
    if (at === null) return;
    const delay = Math.min(Math.max(at - now, 0), MAX_TIMEOUT);
    const timer = setTimeout(() => {
      timers.delete(roomId);
      broadcast(roomId);
    }, delay);
    if (typeof timer.unref === "function") timer.unref();
    timers.set(roomId, timer);
  }

  function broadcast(roomId: string): void {
    io.to(roomId).emit("room:state", registry.roomDTO(roomId, clock()));
    scheduleExpiry(roomId);
  }

  io.on("connection", (socket: Socket) => {
    let joined: string | null = null;

    socket.on("join", (payload: { roomId?: unknown } = {}) => {
      const roomId = normalizeRoomId(payload?.roomId);
      if (!roomId) {
        sendErr(socket, "NO_ROOM", "방 정보가 없습니다.");
        return;
      }
      joined = roomId;
      socket.join(roomId);
      socket.emit("room:state", registry.roomDTO(roomId, clock()));
      scheduleExpiry(roomId);
    });

    socket.on("party:create", (payload: Record<string, unknown> = {}) => {
      const clientId = normalizeClientId(payload?.clientId);
      if (!joined) return sendErr(socket, "NO_ROOM", "방에 먼저 입장하세요.");
      if (!clientId) return sendErr(socket, "NO_CLIENT", "클라이언트 정보가 없습니다.");
      try {
        registry.createParty(joined, {
          clientId,
          nickname: String(payload?.nickname ?? ""),
          position: payload?.position,
          settings: {
            tier: payload?.tier,
            queue: payload?.queue,
            scheduledAt: payload?.scheduledAt,
          },
          now: clock(),
        });
        broadcast(joined);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("party:join", (payload: Record<string, unknown> = {}) => {
      const clientId = normalizeClientId(payload?.clientId);
      const partyId = normalizePartyId(payload?.partyId);
      if (!joined) return sendErr(socket, "NO_ROOM", "방에 먼저 입장하세요.");
      if (!clientId) return sendErr(socket, "NO_CLIENT", "클라이언트 정보가 없습니다.");
      if (!partyId) return sendErr(socket, "PARTY_NOT_FOUND", "파티를 찾을 수 없습니다.");
      try {
        registry.join(
          joined,
          partyId,
          {
            clientId,
            nickname: String(payload?.nickname ?? ""),
            position: payload?.position,
            now: clock(),
          },
          clock(),
        );
        broadcast(joined);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("party:leave", (payload: Record<string, unknown> = {}) => {
      const clientId = normalizeClientId(payload?.clientId);
      const partyId = normalizePartyId(payload?.partyId);
      if (!joined) return;
      if (!clientId || !partyId) return;
      registry.leave(joined, partyId, clientId, clock());
      broadcast(joined);
    });

    socket.on("party:settings", (payload: Record<string, unknown> = {}) => {
      const clientId = normalizeClientId(payload?.clientId);
      const partyId = normalizePartyId(payload?.partyId);
      if (!joined) return sendErr(socket, "NO_ROOM", "방에 먼저 입장하세요.");
      if (!clientId) return sendErr(socket, "NO_CLIENT", "클라이언트 정보가 없습니다.");
      if (!partyId) return sendErr(socket, "PARTY_NOT_FOUND", "파티를 찾을 수 없습니다.");
      try {
        registry.updateSettings(
          joined,
          partyId,
          { tier: payload?.tier, queue: payload?.queue, scheduledAt: payload?.scheduledAt },
          clock(),
        );
        broadcast(joined);
      } catch (error) {
        fail(socket, error);
      }
    });
  });
}
