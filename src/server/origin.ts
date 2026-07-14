/**
 * Origin 화이트리스트. `allowRequest`에 연결해 polling과 WebSocket 두 전송 모두에서 검사한다
 * (브라우저는 WS 핸드셰이크에 SOP를 적용하지 않으므로 cors 옵션만으로는 WS를 막을 수 없다).
 *
 * 안전한 기본값: ALLOWED_ORIGINS 미설정 시 "허용 목록 없음 = 전부 허용"이 아니라
 * 요청의 Origin이 서버 자신의 Host와 같을 때만 허용한다(동일 출처 배포가 기본 시나리오).
 *
 * Origin 헤더가 없는 요청은 허용하지 않는다(우회 방지). 실제 브라우저는 WebSocket
 * 핸드셰이크(RFC 6455)와 polling에 쓰는 XHR/fetch 요청 모두에 Origin을 반드시 싣는다 —
 * 즉 정상적인 브라우저 트래픽에서 Origin이 빠질 일이 없다. Origin이 빠진 요청은 이 서버가
 * 대상으로 삼지 않는 비브라우저 클라이언트(스크립트·봇 등)이거나 화이트리스트를 우회하려는
 * 시도이므로, 화이트리스트가 설정돼 있든 동일 출처 기본값이든 동일하게 거부한다.
 * (이전 구현은 Origin 부재 시 무조건 허용해, ALLOWED_ORIGINS를 두고도 Origin만 생략하면
 * 누구나 통과하는 우회 구멍이 있었다 — 리뷰로 발견되어 수정.)
 *
 * 정말로 Origin을 보낼 수 없는 비브라우저 클라이언트를 허용해야 하는 "운영상 예외"가 생기면,
 * 그 클라이언트가 스스로 Origin 헤더를 보내게 하고(대부분의 HTTP/WS 클라이언트는 커스텀 헤더를
 * 지정할 수 있다) `ALLOWED_ORIGINS`에 추가하는 편이, 서버가 Origin 부재를 통째로 허용하는
 * 것보다 항상 더 안전하다. 그래서 이 모듈은 그런 우회용 옵션을 두지 않는다(YAGNI) —
 * 필요해지면 호출부에서 그 클라이언트 전용 Origin을 명시하도록 요구할 것.
 */
export function parseAllowedOrigins(raw: string | undefined): string[] | null {
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : null;
}

function sameHost(origin: string, host: string): boolean {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function isOriginAllowed(origin: string | undefined, allowlist: string[] | null, host: string | undefined): boolean {
  if (!origin) return false;
  if (allowlist) return allowlist.includes(origin);
  if (!host) return false;
  return sameHost(origin, host);
}
