# 시스템 설계

## 계층

프레임워크 의존성을 안쪽으로 밀어내는 3계층. 도메인은 아무것도 import 하지 않는다.

```
public/ (브라우저)
   │  Socket.IO 이벤트
src/server/  ── socket.ts (게이트웨이) ── rooms.ts (저장 경계)
   │                                         │
   └───────────────── src/domain/ ◀──────────┘
                      roster.ts · positions.ts · errors.ts  (순수)
```

- **domain** — 순수 함수 + 불변 상태. 자리 차지/해제/이동 규칙. 시간은 주입(`now`)받아 결정적.
- **server/rooms** — 여러 방의 현재 상태를 담는 인메모리 저장 경계. roster 값은 불변, 연산마다 교체.
- **server/socket** — Socket.IO 이벤트를 도메인 연산으로 변환하고 방 전체에 브로드캐스트.
- **server/http** — Express 정적 서빙 + Socket.IO 부착. `listen` 없는 팩토리라 테스트가 실서버를 띄운다.
- **public** — 번들러 없는 프론트엔드. 서버가 `/socket.io/socket.io.js`를 자동 제공.

## 데이터 모델

```ts
Seat  = { position, nickname, ownerId, claimedAt }   // ownerId = 소켓 세션 id
RosterState = { seats: Record<Position, Seat | null> }   // 불변
Room  = { id, settings, roster }
RoomSettings = { title, time, tier, queue }
```

**와이어 DTO** (`state` 이벤트 페이로드):

```jsonc
{
  "roomId": "우리방",
  "settings": { "title": "...", "time": "", "tier": "", "queue": "솔랭 / 자유랭" },
  "seats": {
    "TOP": null,
    "MID": { "position": "MID", "nickname": "유자생강차", "ownerId": "<socket id>", "claimedAt": 1700000000000 }
    // JGL, ADC, SUP ...
  },
  "filled": 1
}
```

## 이벤트 프로토콜 (Socket.IO)

| 방향 | 이벤트 | 페이로드 | 설명 |
|------|--------|----------|------|
| C→S | `join` | `{ roomId }` | 방 입장 → 현재 `state` 수신 |
| C→S | `claim` | `{ position, nickname }` | 자리 차지 → 방 전체 `state` |
| C→S | `release` | `{ position }` | 내 자리 비우기 → 방 전체 `state` |
| S→C | `state` | `RoomDTO` | 방의 최신 상태(전체 스냅샷) |
| S→C | `roster:error` | `{ code, message }` | 요청자에게만 오류 통지 |
| (자동) | `disconnect` | — | 그 세션의 자리 해제 → 방 전체 `state` |

오류 코드: `INVALID_POSITION` · `INVALID_NICKNAME` · `POSITION_TAKEN` ·
`SEAT_NOT_FOUND` · `NOT_SEAT_OWNER` · `INVALID_ROOM` · `NOT_JOINED`.

상태는 항상 **전체 스냅샷**을 보낸다(델타 아님). 5칸짜리 작은 상태라 단순함이 이득이다.

## 기술 선택과 대안

| 선택 | 이유 | 대안과 트레이드오프 |
|------|------|---------------------|
| **Socket.IO(자체 호스팅)** | 순수 도메인 → TDD 용이, 외부 계정/시크릿 불필요, 클라이언트 JS 자동 제공, 재연결·룸 내장 | **Supabase Realtime**: 관리형·서버리스지만 계정+API키(시크릿) 필요, 단위 테스트에 목 필요 · **Firebase RTDB**: 유사 · **순수 WebSocket(ws)**: 더 가볍지만 룸/재연결/폴백을 직접 구현 |
| **인메모리 상태** | MVP엔 충분, 의존성 0, 테스트 결정적 | 서버 재시작 시 초기화 · 수평 확장 불가 → ROADMAP에서 Redis/SQLite 어댑터로 교체 (저장 경계를 `rooms.ts`로 이미 격리) |
| **번들러 없는 프론트엔드** | 마이크로사이트 규모, 빌드 파이프라인 불필요 | 규모가 커지면 Vite 도입 |
| **시간 주입(`now`)** | 도메인 순수성·결정적 테스트 | — |

전송 계층을 `socket.ts` / `rooms.ts`로 분리했기 때문에, 나중에 Supabase로 바꾸더라도
`domain/`은 그대로 재사용된다.

## 확장 경로

- **다중 인스턴스**: 인메모리 → Redis 어댑터 + Socket.IO Redis 어댑터(pub/sub)로 브로드캐스트 팬아웃.
- **영속성**: `RoomRegistry`를 인터페이스로 추출 → SQLite/Redis 구현 주입.
- **소유권 안정화**: `ownerId`를 소켓 id가 아니라 localStorage 기반 클라이언트 토큰으로 (ROADMAP #1).

## 업데이트 — v0.2 데이터 모델·이벤트

```ts
GameSettings = { tier: Tier; queue: Queue; scheduledAt: number | null }
Game = { id: number; settings: GameSettings; roster: RosterState }  // id는 만료마다 +1
```
- **소유권**: `Seat.ownerId` = 브라우저 `clientId`(localStorage UUID). 소켓 id 아님 → 재접속에도 유지.
  (v0.5부터는 아래 "보안 강화" 절 참고 — 클라이언트가 직접 자칭하는 값이 아니라 서버가 서명해 발급한다.)
- **지연 만료**: 접근 시 `expireIfDue(game, now)`로 예정 시각 경과를 검사해 새 게임으로 교체.
  접속자에겐 예정 시각에 맞춘 서버 타이머가 자동 반영(unref).
- **이벤트 추가**: `settings:update { tier?, queue?, scheduledAt?, clientId }`.
  `claim/release`는 이제 `clientId`를 함께 받음. 연결 종료로 자리를 풀지 않음(기본 미사용 방만 정리).
- **오류 코드 추가**: `INVALID_TIER` · `INVALID_QUEUE` · `INVALID_TIME`.
- 티어/큐 단일 출처: `src/domain/tiers.ts` · `src/domain/queues.ts`.
```

전송 계층(`server/rooms.ts`)이 저장 경계라, 인메모리→Redis 교체 지점이 여기 하나로 모인다.
```

## 업데이트 — v0.5 보안 강화

### 서버 서명 세션 신원 (`server/session.ts`)

브라우저가 스스로 만들어 보내는 `clientId`는 누구든 아무 값이나 자칭할 수 있어(임퍼스네이션),
다른 사람 자리를 빼거나 파티 설정을 바꿀 수 있는 취약점이었다. v0.5부터는:

- 소켓 연결마다 `io.use()` 미들웨어가 핸드셰이크의 `auth.token`을 검증해 신원(identityId)을
  결정한다. 토큰이 없거나 위조/만료됐으면 새 신원을 발급한다.
- 토큰은 `identityId.만료시각.HMAC서명` 형태로 서버만 아는 시크릿(`SESSION_SECRET`)으로
  서명된다 — 클라이언트는 값을 저장했다 재전송할 뿐, 신원을 자칭할 수 없다.
- 이후 모든 뮤테이션(`party:create/join/leave/settings`)은 페이로드의 어떤 `clientId` 필드도
  읽지 않고 오직 `socket.data.identity`(서버가 검증한 값)만 사용한다 — 임퍼스네이션이 프로토콜
  구조상 불가능해진다.
- 서버는 매 연결마다 새로 서명한 토큰을 `session:token` 이벤트로 클라이언트에 보내
  슬라이딩 만료를 준다. **자격증명(서명된 토큰)은 방 상태(`room:state`) 브로드캐스트에는
  절대 실리지 않는다** — 별도의 1:1 이벤트로만 전달.
- `SESSION_SECRET` 미설정 시 부팅마다 임시 시크릿을 생성한다 — 서버 재시작 시 기존 세션은
  모두 새 신원으로 초기화된다(무기한 익명 영속보다 보안을 우선하는 설계 결정).

### 방 DTO는 다른 사람의 신원을 절대 담지 않는다

`RoomDTO`/`PartyDTO`/`MemberDTO`는 더 이상 `clientId`를 포함하지 않는다. 대신 `roomDTO()`가
보는 사람(viewerId)마다 개인화된 페이로드를 만든다:

```ts
MemberDTO = { nickname, positions, mine: boolean }   // mine = "이게 내 항목인가"
PartyDTO  = { ..., isOwner: boolean }                // isOwner = "내가 이 파티 방장인가"
```

같은 라인을 여러 명이 공유할 수 있어 "내 칩"을 정확히 가리키려면 항목별 `mine` 플래그가
필요하다(파티 단위의 단일 포인터로는 동명이인/동일 라인 상황을 구분 못 함). 방 전체에 같은
페이로드를 브로드캐스트하는 대신, 게이트웨이가 방에 있는 소켓마다 개인화된 DTO를 emit한다
(`server/socket.ts`의 `broadcast()`).

### 방장(owner) 모델

`Party.ownerId`는 파티를 만든 사람의 신원이다. `party:settings`(큐/티어/예정시각 변경)는
`RoomRegistry.updateSettings()`에서 `ownerId`와 호출자 신원이 일치할 때만 허용되고, 아니면
`NOT_OWNER` 오류를 던진다. 방장이 파티를 나가면 남은 멤버 중 가장 먼저 들어온 사람에게
자동으로 넘어간다.

### 칼바람 → 라인 큐 전환: 유령 인원 제거

칼바람(ARAM)은 라인이 없어 `positions: []`로 참가한다. 이 상태에서 방장이 큐를 라인 있는
큐로 바꾸면, 라인을 한 번도 고른 적 없는 멤버는 모든 라인에서 안 보이면서(invisible) 정원은
차지하는(full) 유령 인원이 된다. `domain/party.ts`의 `updateSettings()`는 이 전환에서 라인이
없는 멤버를 파티에서 제거한다(방장 포함 가능 — 남은 멤버 중 최선임자에게 방장이 넘어가고,
아무도 안 남으면 파티 자체가 목록에서 사라진다).

### 소켓당 레이트 리밋 (`server/rate-limit.ts`)

고정 윈도 카운터로 소켓 하나가 짧은 시간에 너무 많은 이벤트(방 입장 포함 모든 뮤테이션)를
보내면 `RATE_LIMITED` 오류로 거절한다. 기본 20회/10초, `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_MS`
로 조정 가능. 연결 종료 시 그 소켓의 카운터를 정리해 메모리가 쌓이지 않는다.

### Origin 화이트리스트 (`server/origin.ts`)

브라우저는 WebSocket 핸드셰이크에 동일 출처 정책(SOP)을 적용하지 않으므로, `cors` 옵션만으로는
악성 사이트의 WS 연결을 막을 수 없다. Socket.IO/Engine.IO의 `allowRequest` 콜백을 붙여
polling·WebSocket 두 전송 모두에서 Origin 헤더를 검사한다.

- `ALLOWED_ORIGINS`(콤마 구분) 설정 시 그 목록만 허용.
- 미설정 시 안전한 기본값: 요청의 Origin이 서버 자신의 Host와 같을 때만 허용(동일 출처 배포가
  기본 시나리오이므로 열린 크로스오리진을 기본값으로 두지 않는다).
- **Origin 헤더가 없는 요청은 항상 거부한다(우회 방지)**. 실제 브라우저는 WebSocket
  핸드셰이크(RFC 6455)와 polling에 쓰는 XHR/fetch 요청 모두에 Origin을 반드시 싣으므로,
  정상적인 브라우저 트래픽에서는 Origin이 빠질 일이 없다. (첫 구현은 Origin 부재 시 무조건
  허용했는데, 이는 `ALLOWED_ORIGINS`를 설정해도 Origin만 생략하면 누구나 통과하는 우회
  구멍이었다 — 코드 리뷰로 발견되어 v0.5.1에서 수정.) 별도의 "비브라우저 예외" 옵션은 두지
  않는다: 정말 필요해지면 그 클라이언트가 Origin 헤더를 직접 보내게 하고 화이트리스트에
  추가하는 편이 서버가 Origin 부재를 통째로 허용하는 것보다 항상 더 안전하다(YAGNI).

### Socket.IO 룸 스위칭

한 소켓이 `join`으로 다른 방으로 갈아탈 때, 이전 Socket.IO 룸에서 명시적으로 `socket.leave()`
한다(`server/socket.ts`). 이전에는 이 처리가 없어 소켓이 여러 방의 브로드캐스트를 계속 받는
누수가 있었다.
