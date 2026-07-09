import { createServer, type Server as HttpServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server as IOServer } from "socket.io";
import { RoomRegistry } from "./rooms";
import { registerRosterGateway, type GatewayOptions } from "./socket";

export interface AppServer {
  httpServer: HttpServer;
  io: IOServer;
  registry: RoomRegistry;
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
  // 프론트엔드를 같은 서버가 제공하므로 기본(동일 출처)만 허용.
  // 교차 출처가 필요하면 CORS_ORIGIN 환경변수로 명시.
  const corsOrigin = process.env.CORS_ORIGIN;
  const io = new IOServer(httpServer, {
    maxHttpBufferSize: 10_000,
    ...(corsOrigin ? { cors: { origin: corsOrigin.split(",") } } : {}),
  });
  const registry = new RoomRegistry();
  registerRosterGateway(io, registry, options);

  return { httpServer, io, registry };
}
