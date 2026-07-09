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

function connect(): ClientSocket {
  const s = ioClient(url, { transports: ["websocket"], forceNew: true });
  sockets.push(s);
  return s;
}
function once<T>(s: ClientSocket, ev: string): Promise<T> {
  return new Promise((res) => s.once(ev, res as (v: unknown) => void));
}

interface RoomDTO {
  roomId: string;
  now: number;
  parties: Array<{
    id: string;
    count: number;
    capacity: number;
    settings: { queue: string; tier: string; scheduledAt: number | null };
    members: Array<{ clientId: string; nickname: string; positions: string[] }>;
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
    a.emit("party:create", { clientId: "ca", nickname: "Alice", positions: ["MID"], queue: "SOLO" });
    const state = await bSees;
    expect(state.parties).toHaveLength(1);
    expect(state.parties[0]?.members[0]?.nickname).toBe("Alice");
    expect(state.parties[0]?.members[0]?.positions).toEqual(["MID"]);
  });

  it("lets a second person join the same party at the same position", async () => {
    const a = connect();
    const b = connect();
    await join(a);
    await join(b);
    const created = once<RoomDTO>(a, "room:state");
    a.emit("party:create", { clientId: "ca", nickname: "Alice", positions: ["MID"], queue: "SOLO" });
    const pid = (await created).parties[0]!.id;
    const joined = once<RoomDTO>(a, "room:state");
    b.emit("party:join", { partyId: pid, clientId: "cb", nickname: "Bob", positions: ["MID"] });
    const s2 = await joined;
    expect(s2.parties[0]?.count).toBe(2);
    expect(s2.parties[0]?.members.every((m) => m.positions.includes("MID"))).toBe(true);
  });

  it("stores no positions for an ARAM party", async () => {
    const a = connect();
    await join(a);
    const created = once<RoomDTO>(a, "room:state");
    a.emit("party:create", { clientId: "ca", nickname: "Alice", positions: ["MID"], queue: "ARAM" });
    const s = await created;
    expect(s.parties[0]?.settings.queue).toBe("ARAM");
    expect(s.parties[0]?.members[0]?.positions).toEqual([]);
  });

  it("removes a party when the last member leaves", async () => {
    const a = connect();
    await join(a);
    const created = once<RoomDTO>(a, "room:state");
    a.emit("party:create", { clientId: "ca", nickname: "Alice", positions: ["MID"], queue: "SOLO" });
    const pid = (await created).parties[0]!.id;
    const left = once<RoomDTO>(a, "room:state");
    a.emit("party:leave", { partyId: pid, clientId: "ca" });
    expect((await left).parties).toHaveLength(0);
  });

  it("emits party:error on an invalid nickname", async () => {
    const a = connect();
    await join(a);
    const err = once<{ code: string }>(a, "party:error");
    a.emit("party:create", { clientId: "ca", nickname: "", positions: ["MID"], queue: "SOLO" });
    expect((await err).code).toBe("INVALID_NICKNAME");
  });

  it("expires a scheduled party after its time passes (lazy on next join)", async () => {
    const a = connect();
    await join(a);
    const created = once<RoomDTO>(a, "room:state");
    a.emit("party:create", {
      clientId: "ca",
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
});
