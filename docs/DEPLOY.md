# 배포 가이드 (Render)

이 앱은 실시간 연결(WebSocket)을 계속 물고 있어야 해서, **Vercel(서버리스)에는 부적합**하다.
항상 켜져 있는 서버를 주는 **Render**(무료)에 올린다. 아래대로 따라 하면 된다.

## 왜 Render / Vercel 아님?
- Vercel·Netlify Functions는 요청마다 짧게 실행되는 서버리스 → Socket.IO의 지속 연결과 안 맞음.
- Render/Railway/Fly는 Node 프로세스를 **계속 띄워** 두므로 실시간에 적합. Render 무료 플랜도 WebSocket 지원.

## 방법 A — 블루프린트(가장 쉬움)
저장소에 이미 `render.yaml`이 있어서 Render가 설정을 자동으로 읽는다.

1. https://render.com 가입 → **GitHub로 로그인**.
2. 대시보드 우상단 **New +** → **Blueprint**.
3. `dmlcksghd/lolMatch` 저장소 선택(처음이면 **Render의 GitHub 접근 승인** — private 저장소라 승인 필요).
4. Render가 `render.yaml`을 읽어 서비스 `lolmatch`(무료, `main` 브랜치)를 제안 → **Apply**.
5. 첫 빌드 2~4분 대기 → `https://lolmatch-XXXX.onrender.com` 주소 발급.

## 방법 B — 수동(블루프린트가 안 보일 때)
1. **New +** → **Web Service** → 저장소 `lolMatch` 연결.
2. 설정값:
   - Branch: **main**
   - Runtime: **Node**
   - Build Command: **npm ci**
   - Start Command: **npm start**
   - Instance Type: **Free**
   - (Advanced) Health Check Path: **/healthz**, 환경변수 `NODE_VERSION=20`
3. **Create Web Service** → 빌드 대기 → 주소 발급.

## 배포 후
- 발급된 주소 뒤에 방 코드를 붙여 카카오톡 오픈채팅방에 공유:
  `https://lolmatch-XXXX.onrender.com/?room=우리방`
- 개발은 `dev`에서 하고, 배포하려면 `dev`를 `main`에 머지·push → Render가 자동 재배포(`autoDeploy: true`).

## 운영 환경변수(권장)
`.env.example` 참고. Render 대시보드 → 서비스 → **Environment** 에서 설정:
- `SESSION_SECRET`: 길고 무작위인 값 고정(`openssl rand -hex 32`). 미설정 시 재배포·재시작마다
  임시 시크릿이 새로 생성되어 **모든 사용자의 로그인(파티 소유권)이 초기화**된다.
- `ALLOWED_ORIGINS`: 프론트를 이 서버가 아닌 다른 도메인에서 서빙한다면 그 오리진을 명시(콤마 구분).
  기본(동일 출처 배포)이라면 비워 둬도 안전한 기본값(same-Host)으로 동작한다.

## 무료 플랜 주의점
- **15분 동안 아무도 안 들어오면 서버가 잠든다.** 다음 사람이 링크를 누르면
  깨어나는 데 **30~60초** 걸린다(첫 접속만 느림). 유료(월 $7)로 올리면 상시 가동.
- 방 상태는 **메모리**에 있어 재배포·잠들기 시 초기화된다(모집판 특성상 대체로 무방).
  영속화가 필요하면 [ROADMAP.md](ROADMAP.md) #2 참고.

## 대안
- **Railway**: railway.app → New Project → Deploy from GitHub → `lolMatch`/`main`.
  Start `npm start`, 자동 감지. 무료 크레딧 소진 시 유료.
- **임시 공개(터널)**: 로컬 `npm run dev` 실행 후 다른 터미널에서
  `npx cloudflared tunnel --url http://localhost:3000` → 임시 `https://…trycloudflare.com` 링크.
  내 컴퓨터를 끄면 링크도 죽는다.

## 서버 잠들지 않게(킵얼라이브)
Render 무료는 15분간 접속이 없으면 잠들고, 깨어날 때 30~60초 걸린다. **외부에서** 주기적으로
깨워주면 계속 살아 있다(서버가 자기 자신에게 보내는 핑은 소용없음 — 인바운드 요청이어야 함).

**권장: UptimeRobot(무료)**
1. https://uptimerobot.com 가입 → Add New Monitor.
2. Type: HTTP(s), URL: `https://<배포주소>/healthz`, 간격: 5분 → 생성. 끝.

**대안: 저장소 GitHub Actions(백업)**
- 배포 후, 리포지토리 **Settings → Secrets and variables → Actions → Variables** 에
  `PING_URL = https://<배포주소>` 추가. `.github/workflows/keepalive.yml`가 10분마다 호출.
  (GitHub 크론은 지연이 잦아 보조 수단으로만.)

> 주의: 킵얼라이브는 *잠들기*만 막는다. **코드 재배포·Render 재시작 때는 인메모리가 초기화**된다.
> 완전 영속이 필요하면 외부 DB로 교체([ROADMAP.md](ROADMAP.md)).
