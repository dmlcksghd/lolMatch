# LOLMatch

> League of Legends 랭크 **5포지션(탑·정글·미드·원딜·서폿) 실시간 모집 보드**
> 링크 하나를 카카오톡 오픈채팅방에 공유하면, 들어온 사람들이 자기 라인을 실시간으로 잡습니다.

카카오톡 오픈채팅방에는 공식 봇 API가 없습니다. 그래서 "방 안의 봇" 대신
**공유 가능한 웹 링크**로 접근합니다 — 안전하고(계정 정지 위험 없음) 어떤 기기에서도 열립니다.

---

## 핵심 기능

- 5개 포지션을 **클릭 한 번**으로 차지 / 해제
- 같은 방(링크)에 있는 모두에게 **실시간 브로드캐스트** (Socket.IO / WebSocket)
- 한 사람 = 한 자리 (다른 라인 클릭 시 자동 이동)
- 연결 끊기면 그 사람 자리는 자동으로 비워짐
- 방(오픈채팅방)마다 독립된 코드 — `?room=코드`
- 라이트/다크 테마, 모바일 우선, 접근성 고려한 헥스테크 UI

## 빠른 시작

```bash
npm install
npm run dev        # 개발 서버 (http://localhost:3000)
npm test           # 전체 테스트 (unit + realtime 통합)
npm run test:cov   # 커버리지 (임계 80%)
npm run typecheck  # 타입 검사
```

방 만들기: `http://localhost:3000/?room=우리방` 링크를 오픈채팅방에 붙여넣기.

## 동작 방식 (한눈에)

```
브라우저(라인 클릭) ──emit "claim"──▶ Socket.IO 게이트웨이
                                        │  도메인 규칙 적용(claim/release)
                                        ▼
                                   RoomRegistry(인메모리 상태)
                                        │  방 전체에
                                        ◀──emit "state"── 브로드캐스트
     모든 참가자 화면이 즉시 갱신 ◀───────┘
```

## 프로젝트 구조

```
src/
  domain/        # 순수 도메인 로직 (프레임워크 무관, TDD 핵심)
    positions.ts #   5개 포지션 정의
    roster.ts    #   자리 차지/해제/이동 규칙 (불변 상태)
    errors.ts    #   도메인 오류 코드
  server/        # 전송/서버 계층
    rooms.ts     #   방 레지스트리 (인메모리 저장 경계)
    socket.ts    #   Socket.IO 이벤트 게이트웨이
    http.ts      #   Express + Socket.IO 서버 팩토리 (테스트 가능)
    index.ts     #   실행 진입점
public/          # 프론트엔드 (번들러 없음)
  index.html  styles.css  app.js
test/            # roster / rooms / socket(통합) 테스트
docs/            # 설계·계획 문서 (아래 참고)
```

## 문서

| 문서 | 내용 |
|------|------|
| [docs/DESIGN.md](docs/DESIGN.md) | 제품·UX 설계, 포지션, 사용자 흐름, 비주얼 방향 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 시스템 설계, 데이터 모델, 이벤트 프로토콜, 기술 선택 근거 |
| [docs/GIT_FLOW.md](docs/GIT_FLOW.md) | 브랜치 전략(dev/main), 커밋·머지 정책, **저작자 표기 정책** |
| [docs/TDD.md](docs/TDD.md) | RED→GREEN→리뷰→커밋→머지 워크플로 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | MVP 이후 개선 과제(보완점) |

## 기술 스택

Node.js 20+ · TypeScript · Express · **Socket.IO** · Vitest
프론트엔드는 번들러 없이 순수 HTML/CSS/JS + 서버가 제공하는 Socket.IO 클라이언트.
