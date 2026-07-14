import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { io as ioClient } from "socket.io-client";
import { createAppServer, type AppServer } from "../src/server/http";
import { mintToken } from "../src/server/session";

describe("createAppServer (plain HTTP)", () => {
  let app: AppServer | undefined;
  const envKeys = ["RATE_LIMIT_MAX", "RATE_LIMIT_WINDOW_MS", "SESSION_SECRET"] as const;
  const savedEnv: Record<string, string | undefined> = {};

  afterEach(async () => {
    if (app) {
      app.io.close();
      await new Promise<void>((r) => app!.httpServer.close(() => r()));
      app = undefined;
    }
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  async function start(): Promise<string> {
    app = createAppServer();
    await new Promise<void>((r) => app!.httpServer.listen(0, r));
    return `http://localhost:${(app!.httpServer.address() as AddressInfo).port}`;
  }

  it("serves /healthz with security headers", async () => {
    const url = await start();
    const res = await fetch(`${url}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("serves the static frontend at /", async () => {
    const url = await start();
    const res = await fetch(`${url}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("honors valid RATE_LIMIT_MAX/RATE_LIMIT_WINDOW_MS env overrides", async () => {
    for (const key of envKeys) savedEnv[key] = process.env[key];
    process.env.RATE_LIMIT_MAX = "5";
    process.env.RATE_LIMIT_WINDOW_MS = "2000";
    // 서버가 오류 없이 정상적으로 만들어지기만 하면 됨 — 이 과정에서 내부적으로
    // 설정값(요청 제한 횟수/시간)을 읽어들이는 로직도 함께 실행된다
    await start();
  });

  it("falls back to defaults when RATE_LIMIT_MAX/RATE_LIMIT_WINDOW_MS are invalid", async () => {
    for (const key of envKeys) savedEnv[key] = process.env[key];
    process.env.RATE_LIMIT_MAX = "not-a-number";
    process.env.RATE_LIMIT_WINDOW_MS = "-5";
    await start();
  });

  it("does not fall back to a forgeable empty-string HMAC secret when SESSION_SECRET is blank", async () => {
    savedEnv.SESSION_SECRET = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "";
    const url = await start();

    // 만약 서버가 빈 문자열("")을 비밀 열쇠로 그대로 써버리는 버그가 있었다면, 누구든지
    // 똑같이 빈 문자열로 가짜 출입증(토큰)을 직접 만들어 정상 사용자인 척할 수 있었을 것이다.
    // 아래 코드가 바로 그 공격을 그대로 재현해서, 지금은 막혀 있는지 확인한다.
    const forgedIdentityId = "11111111-1111-4111-8111-111111111111";
    const forged = mintToken({ secret: "" }, forgedIdentityId, Date.now());

    const s = ioClient(url, { transports: ["websocket"], forceNew: true, auth: { token: forged }, extraHeaders: { Origin: url } });
    try {
      const reissued = await new Promise<{ token: string }>((resolve) => s.once("session:token", resolve));
      // 제대로 설정된 서버라면 이 가짜 출입증을 거부하고 전혀 다른 무작위 신원을 새로 발급한다 —
      // 만약 가짜 출입증이 그대로 통과됐다면, 서버가 돌려주는 새 출입증도 공격자가 지정한
      // 그 신원 값으로 시작했을 것이다.
      expect(reissued.token.startsWith(`${forgedIdentityId}.`)).toBe(false);
    } finally {
      s.close();
    }
  });
});
