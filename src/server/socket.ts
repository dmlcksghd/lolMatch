import type { Server, Socket } from "socket.io";
import { DomainError } from "../domain/errors";
import type { RoomRegistry } from "./rooms";
import { resolveIdentity, generateSessionSecret, type SessionConfig } from "./session";
import { RateLimiter, DEFAULT_RATE_LIMIT, type RateLimitConfig } from "./rate-limit";

export interface GatewayOptions {
  now?: () => number;
  session?: SessionConfig;
  rateLimit?: RateLimitConfig;
}

// setTimeout 상한(32비트) 근처. 그 이상은 상한으로 클램프.
const MAX_TIMEOUT = 2_147_000_000;

function normalizeRoomId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 64 ? trimmed : null;
}

function normalizePartyId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 64 ? trimmed : null;
}

function identityOf(socket: Socket): string {
  return socket.data.identity as string;
}

export function registerRosterGateway(io: Server, registry: RoomRegistry, options: GatewayOptions = {}): void {
  const clock = options.now ?? (() => Date.now());
  const sessionConfig: SessionConfig = options.session ?? { secret: generateSessionSecret() };
  const limiter = new RateLimiter(options.rateLimit ?? DEFAULT_RATE_LIMIT, clock);
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

  /** roomId에 실제로 남아 있는 소켓만(스위치한 소켓은 빠짐). */
  function socketsInRoom(roomId: string): Socket[] {
    const ids = io.sockets.adapter.rooms.get(roomId);
    if (!ids) return [];
    const list: Socket[] = [];
    for (const id of ids) {
      const s = io.sockets.sockets.get(id);
      if (s) list.push(s);
    }
    return list;
  }

  // 상태는 보는 사람마다 다르다(mine/isOwner) — 방 전체에 같은 페이로드를 뿌리지 않고
  // 각 소켓에 개인화된 DTO를 보낸다. 다른 사람의 신원은 어떤 DTO에도 실리지 않는다.
  function broadcast(roomId: string): void {
    const now = clock();
    for (const socket of socketsInRoom(roomId)) {
      socket.emit("room:state", registry.roomDTO(roomId, now, identityOf(socket)));
    }
    scheduleExpiry(roomId);
  }

  // 재접속(새로고침·네트워크 순단)에도 신원이 이어지도록 핸드셰이크 토큰을 검증해
  // 서버가 신원을 배정한다 — 클라이언트가 보낸 clientId를 절대 신뢰하지 않는다.
  io.use((socket, next) => {
    const identity = resolveIdentity(sessionConfig, socket.handshake.auth?.token, clock());
    socket.data.identity = identity.identityId;
    socket.data.sessionToken = identity.token;
    next();
  });

  io.on("connection", (socket: Socket) => {
    let joined: string | null = null;
    socket.emit("session:token", { token: socket.data.sessionToken as string });

    function guarded(handler: (payload: Record<string, unknown>) => void): (payload?: Record<string, unknown>) => void {
      return (payload: Record<string, unknown> = {}) => {
        if (!limiter.consume(socket.id)) {
          sendErr(socket, "RATE_LIMITED", "요청이 너무 많습니다. 잠시 후 다시 시도하세요.");
          return;
        }
        handler(payload);
      };
    }

    socket.on(
      "join",
      guarded((payload) => {
        const roomId = normalizeRoomId(payload?.roomId);
        if (!roomId) {
          sendErr(socket, "NO_ROOM", "방 정보가 없습니다.");
          return;
        }
        // 다른 방으로 갈아탈 때 이전 Socket.IO 룸에서 나가야, 이전 방 브로드캐스트가 새지 않는다.
        if (joined && joined !== roomId) socket.leave(joined);
        joined = roomId;
        socket.join(roomId);
        socket.emit("room:state", registry.roomDTO(roomId, clock(), identityOf(socket)));
        scheduleExpiry(roomId);
      }),
    );

    socket.on(
      "party:create",
      guarded((payload) => {
        if (!joined) return sendErr(socket, "NO_ROOM", "방에 먼저 입장하세요.");
        try {
          registry.createParty(joined, {
            clientId: identityOf(socket),
            nickname: String(payload?.nickname ?? ""),
            positions: payload?.positions,
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
      }),
    );

    socket.on(
      "party:join",
      guarded((payload) => {
        const partyId = normalizePartyId(payload?.partyId);
        if (!joined) return sendErr(socket, "NO_ROOM", "방에 먼저 입장하세요.");
        if (!partyId) return sendErr(socket, "PARTY_NOT_FOUND", "파티를 찾을 수 없습니다.");
        try {
          registry.join(
            joined,
            partyId,
            {
              clientId: identityOf(socket),
              nickname: String(payload?.nickname ?? ""),
              positions: payload?.positions,
              now: clock(),
            },
            clock(),
          );
          broadcast(joined);
        } catch (error) {
          fail(socket, error);
        }
      }),
    );

    socket.on(
      "party:leave",
      guarded((payload) => {
        const partyId = normalizePartyId(payload?.partyId);
        if (!joined || !partyId) return;
        registry.leave(joined, partyId, identityOf(socket), clock());
        broadcast(joined);
      }),
    );

    socket.on(
      "party:settings",
      guarded((payload) => {
        const partyId = normalizePartyId(payload?.partyId);
        if (!joined) return sendErr(socket, "NO_ROOM", "방에 먼저 입장하세요.");
        if (!partyId) return sendErr(socket, "PARTY_NOT_FOUND", "파티를 찾을 수 없습니다.");
        try {
          registry.updateSettings(
            joined,
            partyId,
            identityOf(socket),
            { tier: payload?.tier, queue: payload?.queue, scheduledAt: payload?.scheduledAt },
            clock(),
          );
          broadcast(joined);
        } catch (error) {
          fail(socket, error);
        }
      }),
    );

    socket.on("disconnect", () => {
      limiter.clear(socket.id);
    });
  });
}
