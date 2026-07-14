import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createAppServer, type AppServer } from "../src/server/http";

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;
let clock = NOW;
let app: AppServer;
let url: string;
const sockets: ClientSocket[] = [];

beforeEach(async () => {
  clock = NOW;
  app = createAppServer({ now: () => clock });
  await new Promise<void>((r) => app.httpServer.listen(0, r));
  url = `http://localhost:${(app.httpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  app.io.close();
  await new Promise<void>((r) => app.httpServer.close(() => r()));
});

// 이 테스트들은 ALLOWED_ORIGINS(허용할 출처 목록)를 따로 정하지 않았기 때문에, 서버는 기본값으로
// "같은 주소에서 온 요청만 허용"하는 규칙을 쓴다. 그래서 실제 브라우저처럼 보이려면 접속할 때
// Origin(어디서 접속했는지 알려주는 값)을 서버 주소와 똑같이 넣어줘야 한다 — 진짜 브라우저는
// 어떤 방식으로 접속하든 이 값을 항상 자동으로 보낸다.
function connect(auth?: Record<string, unknown>): ClientSocket {
  const s = ioClient(url, { transports: ["websocket"], forceNew: true, auth, extraHeaders: { Origin: url } });
  sockets.push(s);
  return s;
}
function once<T>(s: ClientSocket, ev: string): Promise<T> {
  return new Promise((res) => s.once(ev, res as (v: unknown) => void));
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface RoomDTO {
  roomId: string;
  now: number;
  parties: Array<{
    id: string;
    count: number;
    capacity: number;
    isOwner: boolean;
    settings: { queue: string; tier: string; scheduledAt: number | null };
    members: Array<{ nickname: string; positions: string[]; mine: boolean }>;
  }>;
}

async function join(s: ClientSocket, roomId = "room-1"): Promise<RoomDTO> {
  const p = once<RoomDTO>(s, "room:state");
  s.emit("join", { roomId });
  return p;
}

describe("socket party gateway", () => {
  it("starts with an empty party list", async () => {
    const s = connect();
    const state = await join(s);
    expect(state.parties).toEqual([]);
  });

  it("creates a party and broadcasts it to everyone in the room", async () => {
    const a = connect();
    const b = connect();
    await join(a);
    await join(b);
    const bSees = once<RoomDTO>(b, "room:state");
    a.emit("party:create", { nickname: "Alice", positions: ["MID"], queue: "SOLO" });
    const state = await bSees;
    expect(state.parties).toHaveLength(1);
    expect(state.parties[0]?.members[0]?.nickname).toBe("Alice");
    expect(state.parties[0]?.members[0]?.positions).toEqual(["MID"]);
    // 파티를 만든 사람이 방장이 되고, 그 외 사람들은 방장이 아니다
    expect(state.parties[0]?.isOwner).toBe(false);
  });

  it("lets a second person join the same party at the same position", async () => {
    const a = connect();
    const b = connect();
    await join(a);
    await join(b);
    const created = once<RoomDTO>(a, "room:state");
    a.emit("party:create", { nickname: "Alice", positions: ["MID"], queue: "SOLO" });
    const pid = (await created).parties[0]!.id;
    const joined = once<RoomDTO>(a, "room:state");
    b.emit("party:join", { partyId: pid, nickname: "Bob", positions: ["MID"] });
    const s2 = await joined;
    expect(s2.parties[0]?.count).toBe(2);
    expect(s2.parties[0]?.members.every((m) => m.positions.includes("MID"))).toBe(true);
  });

  it("stores no positions for an ARAM party", async () => {
    const a = connect();
    await join(a);
    const created = once<RoomDTO>(a, "room:state");
    a.emit("party:create", { nickname: "Alice", positions: ["MID"], queue: "ARAM" });
    const s = await created;
    expect(s.parties[0]?.settings.queue).toBe("ARAM");
    expect(s.parties[0]?.members[0]?.positions).toEqual([]);
  });

  it("removes a party when the last member leaves", async () => {
    const a = connect();
    await join(a);
    const created = once<RoomDTO>(a, "room:state");
    a.emit("party:create", { nickname: "Alice", positions: ["MID"], queue: "SOLO" });
    const pid = (await created).parties[0]!.id;
    const left = once<RoomDTO>(a, "room:state");
    a.emit("party:leave", { partyId: pid });
    expect((await left).parties).toHaveLength(0);
  });

  it("emits party:error on an invalid nickname", async () => {
    const a = connect();
    await join(a);
    const err = once<{ code: string }>(a, "party:error");
    a.emit("party:create", { nickname: "", positions: ["MID"], queue: "SOLO" });
    expect((await err).code).toBe("INVALID_NICKNAME");
  });

  it("rejects a non-string or oversized roomId on join", async () => {
    const a = connect();
    const err1 = once<{ code: string }>(a, "party:error");
    a.emit("join", { roomId: 12345 });
    expect((await err1).code).toBe("NO_ROOM");

    const err2 = once<{ code: string }>(a, "party:error");
    a.emit("join", { roomId: "x".repeat(65) });
    expect((await err2).code).toBe("NO_ROOM");
  });

  it("rejects a non-string or oversized partyId on party:join and party:settings", async () => {
    const a = connect();
    await join(a);

    const err1 = once<{ code: string }>(a, "party:error");
    a.emit("party:join", { partyId: 12345, nickname: "A", positions: ["MID"] });
    expect((await err1).code).toBe("PARTY_NOT_FOUND");

    const err2 = once<{ code: string }>(a, "party:error");
    a.emit("party:settings", { partyId: "x".repeat(65), queue: "ARAM" });
    expect((await err2).code).toBe("PARTY_NOT_FOUND");
  });

  it("expires a scheduled party after its time passes (lazy on next join)", async () => {
    const a = connect();
    await join(a);
    const created = once<RoomDTO>(a, "room:state");
    a.emit("party:create", {
      nickname: "Alice",
      positions: ["MID"],
      queue: "SOLO",
      scheduledAt: NOW + HOUR,
    });
    expect((await created).parties).toHaveLength(1);
    clock = NOW + HOUR;
    const b = connect();
    expect((await join(b)).parties).toHaveLength(0);
  });

  describe("identity & impersonation defenses", () => {
    it("never reveals another member's identity — each viewer only sees their own mine flag", async () => {
      const a = connect();
      const b = connect();
      await join(a);
      await join(b);
      const created = once<RoomDTO>(a, "room:state");
      a.emit("party:create", { nickname: "Alice", positions: ["MID"], queue: "SOLO" });
      const pid = (await created).parties[0]!.id;

      const aSeesBJoin = once<RoomDTO>(a, "room:state");
      b.emit("party:join", { partyId: pid, nickname: "Bob", positions: ["TOP"] });
      const aView = await aSeesBJoin;
      const aMembers = aView.parties[0]!.members;
      expect(aMembers.find((m) => m.nickname === "Alice")?.mine).toBe(true);
      expect(aMembers.find((m) => m.nickname === "Bob")?.mine).toBe(false);
      // 다른 사람이 누구인지 알아낼 수 있는 정보는 어떤 형태로도 새어나가지 않아야 함
      for (const m of aMembers) expect(Object.keys(m).sort()).toEqual(["mine", "nickname", "positions"]);
    });

    it("ignores a spoofed clientId in the payload — a socket can only ever act as its own identity", async () => {
      const a = connect();
      const b = connect();
      await join(a);
      await join(b);
      const created = once<RoomDTO>(a, "room:state");
      a.emit("party:create", { nickname: "Alice", positions: ["MID"], queue: "SOLO" });
      const pid = (await created).parties[0]!.id;

      // B는 이 파티에 들어온 적도 없는 남남인데, Alice의 신원 값을 대충 추측해서 끼워 넣어
      // 강제로 내보내려고 시도한다. 서버는 이렇게 요청에 실려 온 신원 값을 절대 믿으면 안 된다.
      const broadcastAfterAttempt = once<RoomDTO>(a, "room:state");
      b.emit("party:leave", { partyId: pid, clientId: "alice-guessed-id" });
      const state = await broadcastAfterAttempt;
      expect(state.parties[0]?.count).toBe(1);
      expect(state.parties[0]?.members[0]?.nickname).toBe("Alice");
    });

    it("keeps the same identity across a reconnect when the session token is replayed", async () => {
      const a = connect();
      const tokenPromise = once<{ token: string }>(a, "session:token");
      await join(a);
      const { token } = await tokenPromise;
      const created = once<RoomDTO>(a, "room:state");
      a.emit("party:create", { nickname: "Alice", positions: ["MID"], queue: "SOLO" });
      const pid = (await created).parties[0]!.id;
      a.close();

      const reconnected = connect({ token });
      const state = await join(reconnected);
      const party = state.parties.find((p) => p.id === pid);
      expect(party?.members.find((m) => m.mine)?.nickname).toBe("Alice");
      expect(party?.isOwner).toBe(true);
    });

    it("treats a missing or invalid session token as a brand-new identity", async () => {
      const a = connect();
      await join(a);
      const created = once<RoomDTO>(a, "room:state");
      a.emit("party:create", { nickname: "Alice", positions: ["MID"], queue: "SOLO" });
      await created;
      a.close();

      const stranger = connect({ token: "not-a-real-token" });
      const state = await join(stranger);
      expect(state.parties[0]?.members.some((m) => m.mine)).toBe(false);
      expect(state.parties[0]?.isOwner).toBe(false);
    });
  });

  describe("owner-only settings", () => {
    it("rejects party:settings from a non-owner with NOT_OWNER, leaving settings unchanged", async () => {
      const a = connect();
      const b = connect();
      await join(a);
      await join(b);
      const created = once<RoomDTO>(a, "room:state");
      a.emit("party:create", { nickname: "Alice", positions: ["MID"], queue: "SOLO" });
      const pid = (await created).parties[0]!.id;

      const bJoined = once<RoomDTO>(a, "room:state");
      b.emit("party:join", { partyId: pid, nickname: "Bob", positions: ["TOP"] });
      await bJoined;

      const err = once<{ code: string }>(b, "party:error");
      b.emit("party:settings", { partyId: pid, queue: "ARAM" });
      expect((await err).code).toBe("NOT_OWNER");

      const check = once<RoomDTO>(a, "room:state");
      a.emit("party:leave", { partyId: "does-not-exist" }); // 없는 파티라 아무 일도 안 일어나지만, 최신 상태를 다시 받아보려고 일부러 보내는 신호
      const state = await check;
      expect(state.parties[0]?.settings.queue).toBe("SOLO");
    });

    it("lets the owner change settings", async () => {
      const a = connect();
      await join(a);
      const created = once<RoomDTO>(a, "room:state");
      a.emit("party:create", { nickname: "Alice", positions: ["MID"], queue: "SOLO" });
      await created;

      const changed = once<RoomDTO>(a, "room:state");
      a.emit("party:settings", { queue: "FLEX", partyId: (await created).parties[0]!.id });
      const state = await changed;
      expect(state.parties[0]?.settings.queue).toBe("FLEX");
    });
  });

  describe("ARAM -> positional queue transition", () => {
    it("leaves no invisible/full ghost members — positionless members are dropped, not kept invisibly", async () => {
      const a = connect();
      const b = connect();
      await join(a);
      await join(b);
      const created = once<RoomDTO>(a, "room:state");
      a.emit("party:create", { nickname: "Alice", positions: [], queue: "ARAM" });
      const pid = (await created).parties[0]!.id;

      const bJoined = once<RoomDTO>(a, "room:state");
      b.emit("party:join", { partyId: pid, nickname: "Bob", positions: [] });
      const beforeSwitch = await bJoined;
      expect(beforeSwitch.parties[0]?.count).toBe(2);

      // 방장이 큐를 라인 있는 큐로 바꾼다 — 두 사람 다 라인을 골라본 적이 없어서, 그대로 두면
      // 어느 라인에도 안 보이면서 정원만 차지하는 상태가 되어버린다.
      const afterSwitch = once<RoomDTO>(a, "room:state");
      a.emit("party:settings", { partyId: pid, queue: "SOLO" });
      const state = await afterSwitch;
      // 라인을 가진 사람이 한 명도 안 남았으니 파티 자체가 목록에서 통째로 사라져야 한다 —
      // 라인은 다 비어 있는데 정원만 꽉 찬 이상한 파티로 남아있으면 안 된다.
      expect(state.parties.find((p) => p.id === pid)).toBeUndefined();
    });

    it("keeps members who already hold a lane when switching between positional queues", async () => {
      const a = connect();
      await join(a);
      const created = once<RoomDTO>(a, "room:state");
      a.emit("party:create", { nickname: "Alice", positions: ["MID"], queue: "SOLO" });
      const pid = (await created).parties[0]!.id;

      const changed = once<RoomDTO>(a, "room:state");
      a.emit("party:settings", { partyId: pid, queue: "FLEX" });
      const state = await changed;
      expect(state.parties[0]?.count).toBe(1);
      expect(state.parties[0]?.members[0]?.positions).toEqual(["MID"]);
    });
  });

  describe("room switching", () => {
    it("stops receiving broadcasts from a room after switching to a different one", async () => {
      const a = connect();
      await join(a, "room-old");
      await join(a, "room-new"); // 이때 내부적으로 room-old에서는 자동으로 빠져나가야 함

      const observer = connect();
      await join(observer, "room-old");

      let leaked = false;
      a.on("room:state", () => {
        leaked = true;
      });

      const observerSees = once<RoomDTO>(observer, "room:state");
      observer.emit("party:create", { nickname: "Ghost", positions: ["MID"], queue: "SOLO" });
      await observerSees;

      await sleep(50); // 혹시 잘못 새어 들어오는 알림이 있다면 도착할 시간을 잠깐 줌
      expect(leaked).toBe(false);
    });
  });

  describe("rate limiting", () => {
    it("blocks a socket that exceeds the configured mutation budget within a window", async () => {
      const limited = createAppServer({ now: () => clock, rateLimit: { max: 2, windowMs: 10_000 } });
      await new Promise<void>((r) => limited.httpServer.listen(0, r));
      const limitedUrl = `http://localhost:${(limited.httpServer.address() as AddressInfo).port}`;
      const s = ioClient(limitedUrl, { transports: ["websocket"], forceNew: true, extraHeaders: { Origin: limitedUrl } });
      try {
        await join(s); // 1st budget hit
        const secondBroadcast = once<RoomDTO>(s, "room:state");
        s.emit("party:leave", { partyId: "nope" }); // 2nd budget hit — harmless no-op, still broadcasts
        await secondBroadcast;

        const err = once<{ code: string }>(s, "party:error");
        s.emit("party:leave", { partyId: "nope" }); // 3rd — over budget
        expect((await err).code).toBe("RATE_LIMITED");
      } finally {
        s.close();
        limited.io.close();
        await new Promise<void>((r) => limited.httpServer.close(() => r()));
      }
    });
  });
});
