import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createAppServer, type AppServer } from "../src/server/http";

/**
 * ALLOWED_ORIGINS(허용할 출처 목록) 설정이 실제 접속 단계에서 진짜로 작동하는지, polling과
 * WebSocket 두 가지 접속 방식 모두에 대해 실제 서버를 띄워서 확인한다. isOriginAllowed()
 * 함수 하나만 따로 테스트해서는, http.ts에서 이 검사를 빠뜨리고 연결하는 실수(예: polling
 * 방식에는 검사를 안 붙이는 실수)를 잡아낼 수 없기 때문에 이렇게 실제 접속까지 확인한다.
 */
describe("origin allowlisting (integration)", () => {
  let app: AppServer | undefined;
  let url: string;
  let originalEnv: string | undefined;
  const sockets: ClientSocket[] = [];

  beforeEach(() => {
    originalEnv = process.env.ALLOWED_ORIGINS;
  });

  afterEach(async () => {
    for (const s of sockets.splice(0)) s.close();
    if (app) {
      app.io.close();
      await new Promise<void>((r) => app!.httpServer.close(() => r()));
      app = undefined;
    }
    if (originalEnv === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = originalEnv;
  });

  async function start(): Promise<void> {
    app = createAppServer();
    await new Promise<void>((r) => app!.httpServer.listen(0, r));
    url = `http://localhost:${(app!.httpServer.address() as AddressInfo).port}`;
  }

  function connectFrom(origin: string, transports: string[]): ClientSocket {
    const s = ioClient(url, { transports, forceNew: true, extraHeaders: { Origin: origin } });
    sockets.push(s);
    return s;
  }

  // Node로 접속할 때는 별도로 지정하지 않으면 Origin(어디서 접속했는지 알려주는 값) 자체를
  // 아예 안 보낸다 — 이건 브라우저가 아닌 프로그램(또는 우회를 노리는 공격 스크립트)이 이
  // 값을 일부러 빼고 접속을 시도하는 상황을 그대로 흉내 낸 것이다.
  function connectNoOrigin(transports: string[]): ClientSocket {
    const s = ioClient(url, { transports, forceNew: true });
    sockets.push(s);
    return s;
  }

  function waitConnected(s: ClientSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      s.once("connect", () => resolve());
      s.once("connect_error", (err) => reject(err));
    });
  }
  function waitRejected(s: ClientSocket): Promise<void> {
    return new Promise((resolve) => s.once("connect_error", () => resolve()));
  }

  it("rejects a WebSocket handshake from an origin outside the allowlist", async () => {
    process.env.ALLOWED_ORIGINS = "https://allowed.example";
    await start();
    const s = connectFrom("https://evil.example", ["websocket"]);
    await waitRejected(s);
    expect(s.connected).toBe(false);
  });

  it("accepts a WebSocket handshake from an allowlisted origin", async () => {
    process.env.ALLOWED_ORIGINS = "https://allowed.example";
    await start();
    const s = connectFrom("https://allowed.example", ["websocket"]);
    await waitConnected(s);
    expect(s.connected).toBe(true);
  });

  it("rejects a polling handshake from an origin outside the allowlist", async () => {
    process.env.ALLOWED_ORIGINS = "https://allowed.example";
    await start();
    const s = connectFrom("https://evil.example", ["polling"]);
    await waitRejected(s);
    expect(s.connected).toBe(false);
  });

  it("accepts a polling handshake from an allowlisted origin", async () => {
    process.env.ALLOWED_ORIGINS = "https://allowed.example";
    await start();
    const s = connectFrom("https://allowed.example", ["polling"]);
    await waitConnected(s);
    expect(s.connected).toBe(true);
  });

  it("falls back to same-Host matching when ALLOWED_ORIGINS is unset (safe production default)", async () => {
    delete process.env.ALLOWED_ORIGINS;
    await start();
    const sameHostOrigin = `http://localhost:${(app!.httpServer.address() as AddressInfo).port}`;
    const same = connectFrom(sameHostOrigin, ["websocket"]);
    await waitConnected(same);
    expect(same.connected).toBe(true);

    const evil = connectFrom("https://evil.example", ["websocket"]);
    await waitRejected(evil);
    expect(evil.connected).toBe(false);
  });

  describe("Origin header omitted (bypass regression)", () => {
    it("rejects a WebSocket handshake with no Origin header, even with an explicit allowlist", async () => {
      process.env.ALLOWED_ORIGINS = "https://allowed.example";
      await start();
      const s = connectNoOrigin(["websocket"]);
      await waitRejected(s);
      expect(s.connected).toBe(false);
    });

    it("rejects a polling handshake with no Origin header, even with an explicit allowlist", async () => {
      process.env.ALLOWED_ORIGINS = "https://allowed.example";
      await start();
      const s = connectNoOrigin(["polling"]);
      await waitRejected(s);
      expect(s.connected).toBe(false);
    });

    it("rejects a WebSocket handshake with no Origin header under the same-Host default", async () => {
      delete process.env.ALLOWED_ORIGINS;
      await start();
      const s = connectNoOrigin(["websocket"]);
      await waitRejected(s);
      expect(s.connected).toBe(false);
    });

    it("rejects a polling handshake with no Origin header under the same-Host default", async () => {
      delete process.env.ALLOWED_ORIGINS;
      await start();
      const s = connectNoOrigin(["polling"]);
      await waitRejected(s);
      expect(s.connected).toBe(false);
    });
  });
});
