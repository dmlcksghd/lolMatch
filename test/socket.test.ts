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

interface StateDTO {
  roomId: string;
  gameId: number;
  filled: number;
  settings: { tier: string; queue: string; scheduledAt: number | null };
  seats: Record<string, { nickname: string; ownerId: string } | null>;
}

describe("gateway — join & claim", () => {
  it("sends game state on join", async () => {
    const c = connect();
    c.emit("join", { roomId: "r1" });
    const s = await once<StateDTO>(c, "state");
    expect(s.gameId).toBe(1);
    expect(s.filled).toBe(0);
    expect(s.settings.queue).toBe("SOLO");
  });

  it("broadcasts a claim to everyone in the room", async () => {
    const a = connect();
    const b = connect();
    a.emit("join", { roomId: "r" });
    await once(a, "state");
    b.emit("join", { roomId: "r" });
    await once(b, "state");
    const upd = once<StateDTO>(b, "state");
    a.emit("claim", { position: "MID", nickname: "유자생강차", clientId: "cA" });
    const s = await upd;
    expect(s.seats.MID?.nickname).toBe("유자생강차");
    expect(s.filled).toBe(1);
  });

  it("rejects a claim without a clientId", async () => {
    const c = connect();
    c.emit("join", { roomId: "r" });
    await once(c, "state");
    const err = once<{ code: string }>(c, "roster:error");
    c.emit("claim", { position: "MID", nickname: "A" });
    expect((await err).code).toBe("NO_CLIENT");
  });

  it("emits roster:error on an invalid position", async () => {
    const c = connect();
    c.emit("join", { roomId: "r" });
    await once(c, "state");
    const err = once<{ code: string }>(c, "roster:error");
    c.emit("claim", { position: "ZZZ", nickname: "A", clientId: "cA" });
    expect((await err).code).toBe("INVALID_POSITION");
  });
});

describe("persistence — seats survive disconnect", () => {
  it("keeps a claimed seat after the claimer disconnects", async () => {
    const a = connect();
    a.emit("join", { roomId: "keep" });
    await once(a, "state");
    const claimed = once<StateDTO>(a, "state");
    a.emit("claim", { position: "TOP", nickname: "방장", clientId: "cA" });
    await claimed;
    a.close();
    await new Promise((r) => setTimeout(r, 50));
    const b = connect();
    b.emit("join", { roomId: "keep" });
    const s = await once<StateDTO>(b, "state");
    expect(s.filled).toBe(1);
    expect(s.seats.TOP?.nickname).toBe("방장");
  });
});

describe("release ownership by clientId", () => {
  it("lets the owner release, rejects others", async () => {
    const a = connect();
    a.emit("join", { roomId: "rel" });
    await once(a, "state");
    const claimed = once<StateDTO>(a, "state");
    a.emit("claim", { position: "ADC", nickname: "A", clientId: "cA" });
    await claimed;

    const err = once<{ code: string }>(a, "roster:error");
    a.emit("release", { position: "ADC", clientId: "cX" });
    expect((await err).code).toBe("NOT_SEAT_OWNER");

    const rel = once<StateDTO>(a, "state");
    a.emit("release", { position: "ADC", clientId: "cA" });
    expect((await rel).filled).toBe(0);
  });
});

describe("settings", () => {
  it("broadcasts tier / queue / time updates", async () => {
    const a = connect();
    a.emit("join", { roomId: "set" });
    await once(a, "state");
    const upd = once<StateDTO>(a, "state");
    a.emit("settings:update", { tier: "GOLD", queue: "ARAM", scheduledAt: NOW + HOUR, clientId: "cA" });
    const s = await upd;
    expect(s.settings.tier).toBe("GOLD");
    expect(s.settings.queue).toBe("ARAM");
    expect(s.settings.scheduledAt).toBe(NOW + HOUR);
  });

  it("emits roster:error on an invalid tier", async () => {
    const a = connect();
    a.emit("join", { roomId: "t" });
    await once(a, "state");
    const err = once<{ code: string }>(a, "roster:error");
    a.emit("settings:update", { tier: "WOOD", clientId: "cA" });
    expect((await err).code).toBe("INVALID_TIER");
  });
});

describe("game expiry (lazy)", () => {
  it("opens a fresh game when the scheduled time passes", async () => {
    const a = connect();
    a.emit("join", { roomId: "exp" });
    await once(a, "state");

    let s = once<StateDTO>(a, "state");
    a.emit("settings:update", { scheduledAt: NOW + HOUR, clientId: "cA" });
    await s;

    s = once<StateDTO>(a, "state");
    a.emit("claim", { position: "MID", nickname: "A", clientId: "cA" });
    expect((await s).filled).toBe(1);

    clock = NOW + HOUR + 1; // 예정 시각 경과
    a.emit("join", { roomId: "exp" });
    const after = await once<StateDTO>(a, "state");
    expect(after.gameId).toBe(2);
    expect(after.filled).toBe(0);
    expect(after.settings.scheduledAt).toBeNull();
  });
});
