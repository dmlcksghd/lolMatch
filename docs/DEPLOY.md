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
4. Render가 `render.yaml`을 읽어 서비스 `lolmatch`(무료, `dev` 브랜치)를 제안 → **Apply**.
5. 첫 빌드 2~4분 대기 → `https://lolmatch-XXXX.onrender.com` 주소 발급.

## 방법 B — 수동(블루프린트가 안 보일 때)
1. **New +** → **Web Service** → 저장소 `lolMatch` 연결.
2. 설정값:
   - Branch: **dev**
   - Runtime: **Node**
   - Build Command: **npm ci**
   - Start Command: **npm start**
   - Instance Type: **Free**
   - (Advanced) Health Check Path: **/healthz**, 환경변수 `NODE_VERSION=20`
3. **Create Web Service** → 빌드 대기 → 주소 발급.

## 배포 후
- 발급된 주소 뒤에 방 코드를 붙여 카카오톡 오픈채팅방에 공유:
  `https://lolmatch-XXXX.onrender.com/?room=우리방`
- 코드를 고치면: `dev`에 push → Render가 자동 재배포(`autoDeploy: true`).

## 무료 플랜 주의점
- **15분 동안 아무도 안 들어오면 서버가 잠든다.** 다음 사람이 링크를 누르면
  깨어나는 데 **30~60초** 걸린다(첫 접속만 느림). 유료(월 $7)로 올리면 상시 가동.
- 방 상태는 **메모리**에 있어 재배포·잠들기 시 초기화된다(모집판 특성상 대체로 무방).
  영속화가 필요하면 [ROADMAP.md](ROADMAP.md) #2 참고.

## 대안
- **Railway**: railway.app → New Project → Deploy from GitHub → `lolMatch`/`dev`.
  Start `npm start`, 자동 감지. 무료 크레딧 소진 시 유료.
- **임시 공개(터널)**: 로컬 `npm run dev` 실행 후 다른 터미널에서
  `npx cloudflared tunnel --url http://localhost:3000` → 임시 `https://…trycloudflare.com` 링크.
  내 컴퓨터를 끄면 링크도 죽는다.
