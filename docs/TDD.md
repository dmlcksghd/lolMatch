# TDD 워크플로

기능마다 아래 사이클을 돈다.

```
RED  →  GREEN  →  코드리뷰  →  수정  →  코드리뷰  →  커밋  →  머지
```

1. **RED** — 원하는 동작을 실패하는 테스트로 먼저 쓴다. 실행해서 실패를 확인한다.
2. **GREEN** — 테스트를 통과시키는 최소 구현을 한다. 다시 실행해 초록불 확인.
3. **코드리뷰** — 품질/보안/가독성 리뷰. 지적사항 수정 후 재리뷰.
4. **커밋** — 기능 단위로 커밋(테스트 + 구현 함께). → [GIT_FLOW.md](GIT_FLOW.md)
5. **머지** — 기능 브랜치를 `dev`로 `--no-ff` 병합, `origin/dev` 푸시.

## 테스트 계층

| 파일 | 대상 | 성격 |
|------|------|------|
| `test/party.test.ts` | 도메인 규칙(파티 생성/참가/나가기/설정/방장/불변성) | 순수 단위 |
| `test/rooms.test.ts` | 방 레지스트리(격리·오류 전파·DTO·방장 강제·용량 한도) | 단위 |
| `test/session.test.ts` | 세션 토큰 발급/검증(위조·만료·형식 오류) | 순수 단위 |
| `test/rate-limit.test.ts` | 소켓당 레이트 리밋(고정 윈도) | 순수 단위 |
| `test/origin.test.ts` | Origin 화이트리스트 매칭 로직 | 순수 단위 |
| `test/http.test.ts` | HTTP 서버(헬스체크·보안 헤더·정적 서빙) | 통합 |
| `test/origin-allowlist.test.ts` | 실서버 핸드셰이크에서 Origin 차단(WS·polling) | 통합 |
| `test/socket.test.ts` | 실서버를 띄운 **실시간 통합** — 브로드캐스트/룸 격리/임퍼스네이션·방장 방어/레이트리밋 | 통합 |

## 실행

```bash
npm test           # 전체 1회 실행
npm run test:watch # 감시 모드(개발 중)
npm run test:cov   # 커버리지 — 임계 라인/함수/브랜치/구문 80%
```

## 커버리지 목표

최소 **80%** (`vitest.config.ts`의 `coverage.thresholds`로 강제).
실행 진입점 `src/server/index.ts`는 커버리지 대상에서 제외(부팅 코드).

## 예시 (도메인 `claim`)

```ts
// RED: 아직 roster.ts가 없어 import부터 실패
it("fills an empty position with the player", () => {
  const r = claim(createRoster(), { position: "MID", nickname: "유자생강차", ownerId: "s1", now: NOW });
  expect(r.seats.MID).toEqual({ position: "MID", nickname: "유자생강차", ownerId: "s1", claimedAt: NOW });
});
// GREEN: roster.ts에 claim 구현 → 통과
```
