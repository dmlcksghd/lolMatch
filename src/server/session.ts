import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * 서버 서명 세션 토큰. 브라우저가 보내는 clientId를 그대로 신뢰하지 않기 위한 장치 —
 * 신원(identityId)은 서버가 발급하고, 토큰은 HMAC으로 서명되어 클라이언트가 위조할 수 없다.
 * 무기한 영속보다 보안을 우선한다: 토큰은 TTL 후 만료되고, 그러면 새 신원이 발급된다.
 */

export const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일
const MAX_TOKEN_LENGTH = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS_RE = /^\d{1,19}$/;

export interface SessionConfig {
  secret: string;
  ttlMs?: number;
}

export interface ResolvedIdentity {
  identityId: string;
  /** 매 연결마다 새로 서명해 슬라이딩 만료를 준다(클라이언트는 그대로 저장/재전송). */
  token: string;
}

/** SESSION_SECRET 미설정 시 부팅마다 쓰는 임시 시크릿. 재시작하면 이전 세션은 새 신원으로 대체된다. */
export function generateSessionSecret(): string {
  return randomBytes(32).toString("hex");
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function mintToken(config: SessionConfig, identityId: string, now: number): string {
  const ttlMs = config.ttlMs ?? DEFAULT_SESSION_TTL_MS;
  const expiresAt = String(now + ttlMs);
  const payload = `${identityId}.${expiresAt}`;
  return `${payload}.${sign(config.secret, payload)}`;
}

/** 토큰이 유효하면 신원 id를, 위조·만료·형식 오류면 null을 반환한다. */
export function verifyToken(config: SessionConfig, token: unknown, now: number): string | null {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [identityId, expiresAtRaw, signature] = parts;
  if (!identityId || !UUID_RE.test(identityId)) return null;
  if (!expiresAtRaw || !DIGITS_RE.test(expiresAtRaw)) return null;
  if (!signature) return null;
  const expected = sign(config.secret, `${identityId}.${expiresAtRaw}`);
  if (!timingSafeEqualStr(expected, signature)) return null;
  if (Number(expiresAtRaw) <= now) return null;
  return identityId;
}

/**
 * 핸드셰이크에서 받은 토큰을 검증해 신원을 복원하거나(재접속), 없거나 위조/만료면
 * 새 신원을 발급한다. 항상 새로 서명된 토큰을 함께 반환해 클라이언트가 갱신 저장하게 한다.
 */
export function resolveIdentity(config: SessionConfig, providedToken: unknown, now: number): ResolvedIdentity {
  const verified = verifyToken(config, providedToken, now);
  const identityId = verified ?? randomUUID();
  return { identityId, token: mintToken(config, identityId, now) };
}
