/**
 * 소켓당 고정 윈도(fixed-window) 레이트 리밋. 스팸/버그 클라이언트가 파티 변경
 * 이벤트를 무제한으로 쏘는 것을 막는다 — 정교한 슬라이딩 로그 대신 실용적인 카운터로 충분하다.
 */
export interface RateLimitConfig {
  max: number;
  windowMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = { max: 20, windowMs: 10_000 };

interface Window {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, Window>();

  constructor(
    private readonly config: RateLimitConfig,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** true면 허용(소비됨), false면 이번 윈도 한도 초과. */
  consume(key: string): boolean {
    const now = this.now();
    const existing = this.hits.get(key);
    if (!existing || now >= existing.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.config.windowMs });
      return true;
    }
    if (existing.count >= this.config.max) return false;
    existing.count += 1;
    return true;
  }

  /** 소켓 연결 종료 시 호출해 메모리가 계속 쌓이지 않게 한다. */
  clear(key: string): void {
    this.hits.delete(key);
  }

  size(): number {
    return this.hits.size;
  }
}
