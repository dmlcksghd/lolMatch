# LOLMatch

> League of Legends 랭크 **5포지션(탑·정글·미드·원딜·서폿) 저장형 실시간 모집 보드**
> 링크 하나를 카카오톡 오픈채팅방에 공유하면, 들어온 사람들이 시간·티어·큐를 정하고
> 자기 라인을 **저장**합니다. 창을 닫거나 나중에 들어와도 유지됩니다.

카카오톡 오픈채팅방에는 공식 봇 API가 없어, "방 안의 봇" 대신 **공유 가능한 웹 링크**로 접근한다 —
안전하고(계정 정지 위험 없음) 어떤 기기에서도 열린다.

## 핵심 기능
- 5개 포지션을 **클릭 한 번으로 저장/해제** — 연결이 끊겨도 유지(브라우저 `clientId` 소유권).
- **설정 편집**: 예정 시간, 티어(아이언~챌린저·상관없음), 큐(일반게임·칼바람·솔로랭크·자유랭크·5인 자유랭·기타).
- **게임 수명**: 예정 시각까지 수정 가능, 지나면 자동으로 **새 게임(빈 자리)**이 열림 + 마감 카운트다운.
- 같은 방(링크)의 모두에게 **실시간 반영**(Socket.IO). 방마다 독립 코드 `?room=코드`.
- 라이트/다크, 모바일 우선, 접근성 고려한 헥스테크 UI.

## 빠른 시작
```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 전체 테스트(unit + realtime 통합, 52개)
npm run test:cov   # 커버리지(임계 80%)
npm run typecheck
```
방: `http://localhost:3000/?room=우리방` 링크를 오픈채팅방에 공유.

## 동작 방식
```
브라우저(라인 클릭/설정 변경) ─emit claim·settings:update(+clientId)→ Socket.IO 게이트웨이
                                        │  도메인 규칙 + 예정시각 만료 검사
                                        ▼
                                  RoomRegistry(인메모리 저장 · 연결과 무관)
                                        │  방 전체에
                                        ◀──emit state── 브로드캐스트
      모든 참가자 화면 즉시 갱신 ◀────────┘
```

## 구조
```
src/domain/   positions·tiers·queues·roster·game(수명/설정)·errors  (순수, TDD 핵심)
src/server/   rooms(저장 경계)·socket(게이트웨이)·http·index
public/       index.html·styles.css·app.js  (번들러 없음)
test/         roster·game·rooms·socket(통합)
docs/         DESIGN·ARCHITECTURE·GIT_FLOW·TDD·ROADMAP·DEPLOY
```

## 문서
| 문서 | 내용 |
|------|------|
| [docs/DESIGN.md](docs/DESIGN.md) | 제품·UX, 포지션·티어·큐, 저장/수명 흐름 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 시스템 설계, 데이터 모델, 이벤트, 기술 선택 |
| [docs/GIT_FLOW.md](docs/GIT_FLOW.md) | 브랜치(dev/main)·커밋·머지, **저작자 표기 정책** |
| [docs/TDD.md](docs/TDD.md) | RED→GREEN→리뷰→커밋→머지 |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Render 배포 + **킵얼라이브** |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 완료 항목 + 남은 과제 |

## 배포
실시간(WebSocket) 때문에 **Vercel은 부적합**, **Render**(무료) 등에 배포 — [docs/DEPLOY.md](docs/DEPLOY.md).
저장소에 `render.yaml` 블루프린트 포함(‘main’ 브랜치 배포). 무료 서버가 잠들지 않게 하는 킵얼라이브도 문서에 있음.

> 저장은 인메모리라 서버 재배포·재시작 시 초기화된다. 완전 영속이 필요하면 외부 DB로 교체(ROADMAP).

## 기술 스택
Node.js 20+ · TypeScript · Express · **Socket.IO** · Vitest. 프론트는 번들러 없이 서버가 제공하는 Socket.IO 클라이언트 사용.
