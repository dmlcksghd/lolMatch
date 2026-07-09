import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createAppServer, type AppServer } from "../src/server/http";

let app: AppServer;
let url: string;
const sockets: ClientSocket[] = [];

beforeEach(async () => {
  app = createAppServer({ now: () => 1_700_000_000_000 });
  await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
  const { port } = app.httpServer.address() as AddressInfo;
  url = `http://localhost:${port}`;
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  app.io.close();
  await new Promise<void>((resolve) => app.httpServer.close(() => resolve()));
});

function connect(): ClientSocket {
  const s = ioClient(url, { transports: ["websocket"], forceNew: true });
  sockets.push(s);
  return s;
}
function once<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve as (v: unknown) => void));
}

interface StateDTO {
  roomId: string;
  filled: number;
  seats: Record<string, { nickname: string; ownerId: string } | null>;
}

describe("realtime roster gateway", () => {
  it("sends current state to a client on join", async () => {
    const c = connect();
    c.emit("join", { roomId: "room1" });
    const state = await once<StateDTO>(c, "state");
    expect(state.roomId).toBe("room1");
    expect(state.filled).toBe(0);
  });

  it("broadcasts a claim to every client in the room", async () => {
    const a = connect();
    const b = connect();
    a.emit("join", { roomId: "r" });
    await once(a, "state");
    b.emit("join", { roomId: "r" });
    await once(b, "state");

    const bUpdate = once<StateDTO>(b, "state");
    a.emit("claim", { position: "MID", nickname: "유자생강차" });
    const state = await bUpdate;
    expect(state.seats.MID?.nickname).toBe("유자생강차");
    expect(state.filled).toBe(1);
  });

  it("does not leak a claim to a different room", async () => {
    const a = connect();
    const b = connect();
    a.emit("join", { roomId: "roomA" });
    await once(a, "state");
    b.emit("join", { roomId: "roomB" });
    await once(b, "state");

    let leaked = false;
    b.on("state", () => {
      leaked = true;
    });
    a.emit("claim", { position: "TOP", nickname: "A" });
    await once(a, "state");
    await new Promise((r) => setTimeout(r, 80));
    expect(leaked).toBe(false);
  });

  it("emits roster:error on an invalid position", async () => {
    const c = connect();
    c.emit("join", { roomId: "e" });
    await once(c, "state");
    const errP = once<{ code: string }>(c, "roster:error");
    c.emit("claim", { position: "ZZZ", nickname: "A" });
    expect((await errP).code).toBe("INVALID_POSITION");
  });

  it("frees a player's seat when they disconnect", async () => {
    const a = connect();
    const b = connect();
    a.emit("join", { roomId: "d" });
    await once(a, "state");
    b.emit("join", { roomId: "d" });
    await once(b, "state");

    a.emit("claim", { position: "ADC", nickname: "A" });
    await once(b, "state");
    const afterLeave = once<StateDTO>(b, "state");
    a.close();
    expect((await afterLeave).filled).toBe(0);
  });
});

describe("realtime roster gateway — release & guards", () => {
  it("broadcasts a release to everyone in the room", async () => {
    const a = connect();
    const b = connect();
    a.emit("join", { roomId: "rel" });
    await once(a, "state");
    b.emit("join", { roomId: "rel" });
    await once(b, "state");

    a.emit("claim", { position: "SUP", nickname: "A" });
    await once(b, "state");
    const relUpdate = once<StateDTO>(b, "state");
    a.emit("release", { position: "SUP" });
    expect((await relUpdate).filled).toBe(0);
  });

  it("rejects a claim before joining with NOT_JOINED", async () => {
    const c = connect();
    const errP = once<{ code: string }>(c, "roster:error");
    c.emit("claim", { position: "MID", nickname: "A" });
    expect((await errP).code).toBe("NOT_JOINED");
  });

  it("rejects a join with a blank room code", async () => {
    const c = connect();
    const errP = once<{ code: string }>(c, "roster:error");
    c.emit("join", { roomId: "   " });
    expect((await errP).code).toBe("INVALID_ROOM");
  });
});

describe("realtime roster gateway — room switching & eviction", () => {
  it("releases the seat in the old room when a client switches rooms", async () => {
    const a = connect();
    const watcher = connect();
    a.emit("join", { roomId: "old" });
    await once(a, "state");
    watcher.emit("join", { roomId: "old" });
    await once(watcher, "state");

    a.emit("claim", { position: "TOP", nickname: "A" });
    await once(watcher, "state");

    const freed = once<StateDTO>(watcher, "state");
    a.emit("join", { roomId: "new" });
    expect((await freed).filled).toBe(0);
  });

  it("reaps a room from the registry once its last seat is released", async () => {
    const c = connect();
    c.emit("join", { roomId: "solo" });
    await once(c, "state");
    c.emit("claim", { position: "ADC", nickname: "A" });
    await once(c, "state");
    expect(app.registry.size()).toBeGreaterThanOrEqual(1);

    const gone = once<StateDTO>(c, "state");
    c.emit("release", { position: "ADC" });
    await gone;
    expect(app.registry.get("solo")).toBeUndefined();
  });
});
