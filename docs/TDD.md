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
| `test/roster.test.ts` | 도메인 규칙(차지/해제/이동/검증/불변성) | 순수 단위 |
| `test/rooms.test.ts` | 방 레지스트리(격리·오류 전파·DTO) | 단위 |
| `test/socket.test.ts` | 실서버를 띄운 **실시간 통합** — 브로드캐스트/룸 격리/연결 종료 | 통합 |

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
