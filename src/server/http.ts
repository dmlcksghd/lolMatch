import { createServer, type Server as HttpServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server as IOServer } from "socket.io";
import { RoomRegistry } from "./rooms";
import { registerRosterGateway, type GatewayOptions } from "./socket";
import { generateSessionSecret } from "./session";
import { parseAllowedOrigins, isOriginAllowed } from "./origin";
import { DEFAULT_RATE_LIMIT } from "./rate-limit";

export interface AppServer {
  httpServer: HttpServer;
  io: IOServer;
  registry: RoomRegistry;
}

function readRateLimit(): { max: number; windowMs: number } {
  const max = Number(process.env.RATE_LIMIT_MAX);
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS);
  return {
    max: Number.isFinite(max) && max > 0 ? max : DEFAULT_RATE_LIMIT.max,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DEFAULT_RATE_LIMIT.windowMs,
  };
}

export function createAppServer(options: GatewayOptions = {}): AppServer {
  const app = express();
  app.disable("x-powered-by");

  // 기본 보안 헤더(추가 의존성 없이). CSP는 배포 시 리버스 프록시에서 부여 권장.
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });

  const here = dirname(fileURLToPath(import.meta.url));
  const publicDir = join(here, "..", "..", "public");

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });
  app.use(express.static(publicDir));

  const httpServer = createServer(app);

  // ALLOWED_ORIGINS 미설정 시 안전한 기본값(같은 Host만 허용)으로 폴백한다 — 열린 크로스오리진이
  // 기본값이 되지 않게 한다. allowRequest는 polling과 WebSocket 두 전송 모두에서 실행되므로,
  // 브라우저가 WS 핸드셰이크엔 SOP를 적용하지 않는 문제를 여기서 실제로 막는다.
  const allowlist = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
  const io = new IOServer(httpServer, {
    maxHttpBufferSize: 10_000,
    ...(allowlist ? { cors: { origin: allowlist } } : {}),
    allowRequest: (req, callback) => {
      const ok = isOriginAllowed(req.headers.origin, allowlist, req.headers.host, {
        referer: req.headers.referer,
        secFetchSite: req.headers["sec-fetch-site"],
      });
      callback(ok ? null : "origin not allowed", ok);
    },
  });
  const registry = new RoomRegistry();
  registerRosterGateway(io, registry, {
    session: { secret: process.env.SESSION_SECRET || generateSessionSecret() },
    rateLimit: readRateLimit(),
    ...options,
  });

  return { httpServer, io, registry };
}
