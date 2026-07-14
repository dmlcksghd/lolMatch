/**
 * Origin 화이트리스트. `allowRequest`에 연결해 polling과 WebSocket 두 전송 모두에서 검사한다
 * (브라우저는 WS 핸드셰이크에 SOP를 적용하지 않으므로 cors 옵션만으로는 WS를 막을 수 없다).
 *
 * 안전한 기본값: ALLOWED_ORIGINS 미설정 시 "허용 목록 없음 = 전부 허용"이 아니라
 * 요청의 Origin이 서버 자신의 Host와 같을 때만 허용한다(동일 출처 배포가 기본 시나리오).
 *
 * 브라우저의 동일 출처 polling GET은 Origin을 보내지 않을 수 있다. 이 정상 요청은
 * Sec-Fetch-Site가 same-origin이고 Referer의 Host도 요청 Host와 일치할 때만 허용한다.
 * 두 증거가 없거나 서로 모순되면 Origin 생략 우회로 보고 거부한다. WebSocket과
 * 크로스오리진 polling은 Origin을 보내므로 아래의 기존 Origin 정책을 그대로 적용한다.
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

export interface OriginRequestMetadata {
  referer?: string;
  secFetchSite?: string;
}

export function isOriginAllowed(
  origin: string | undefined,
  allowlist: string[] | null,
  host: string | undefined,
  metadata: OriginRequestMetadata = {},
): boolean {
  if (!origin) {
    return Boolean(
      host &&
        metadata.secFetchSite === "same-origin" &&
        metadata.referer &&
        sameHost(metadata.referer, host),
    );
  }
  // The app must remain usable on Render's generated hostname and custom domains.
  // An explicit list adds cross-origin deployments; it must not disable the app's
  // own same-origin browser connection when the platform hostname differs from a
  // stale/configured value.
  if (host && sameHost(origin, host)) return true;
  return allowlist?.includes(origin) ?? false;
}
