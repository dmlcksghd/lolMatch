/* global io */
const LANES = [
  { id: "TOP", ko: "탑", en: "TOP" },
  { id: "JGL", ko: "정글", en: "JUNGLE" },
  { id: "MID", ko: "미드", en: "MID" },
  { id: "ADC", ko: "원딜", en: "BOT · ADC" },
  { id: "SUP", ko: "서폿", en: "SUPPORT" },
];
const ICONS = {
  TOP: '<path d="M12 3v10"/><path d="m8 7 4-4 4 4"/><path d="M6 21h12l-3-6H9z"/>',
  JGL: '<path d="M12 21c0-6 0-9-4-13"/><path d="M12 21c0-6 0-9 4-13"/><path d="M12 12c-3-1-5-4-5-8 4 1 6 4 6 8"/>',
  MID: '<path d="M4 20 20 4"/><path d="M14 4h6v6"/><path d="M10 20H4v-6"/>',
  ADC: '<circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  SUP: '<path d="M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6z"/><path d="M12 9v5M9.5 11.5h5"/>',
};
const TIERS = [
  ["ANY", "상관없음"], ["IRON", "아이언"], ["BRONZE", "브론즈"], ["SILVER", "실버"],
  ["GOLD", "골드"], ["PLATINUM", "플래티넘"], ["EMERALD", "에메랄드"], ["DIAMOND", "다이아몬드"],
  ["MASTER", "마스터"], ["GRANDMASTER", "그랜드마스터"], ["CHALLENGER", "챌린저"],
];
const QUEUES = [
  ["NORMAL", "일반게임"], ["ARAM", "칼바람"], ["SOLO", "솔로랭크"],
  ["FLEX", "자유랭크"], ["FLEX5", "5인 자유랭"], ["OTHER", "기타"],
];

const $ = (s) => document.querySelector(s);
const lanesEl = $("#lanes");
const nickEl = $("#nick");
const filledEl = $("#filled");
const countEl = $("#count");
const connEl = $("#conn");
const toastEl = $("#toast");
const tierEl = $("#set-tier");
const queueEl = $("#set-queue");
const timeEl = $("#set-time");
const deadlineEl = $("#deadline");
const gamenoEl = $("#gameno");

const params = new URLSearchParams(location.search);
const roomId = (params.get("room") || "main").slice(0, 64);
$("#roomcode").textContent = roomId;

// 브라우저마다 고정된 클라이언트 식별자 → 자리 소유권(연결이 끊겨도 유지).
const clientId = getClientId();
function getClientId() {
  try {
    let id = localStorage.getItem("lolmatch:clientId");
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) || Date.now().toString(36) + Math.random().toString(36).slice(2);
      localStorage.setItem("lolmatch:clientId", id);
    }
    return id;
  } catch (_) {
    return "anon-" + Math.random().toString(36).slice(2);
  }
}

try {
  nickEl.value = localStorage.getItem("lolmatch:nick") || "";
} catch (_) {
  /* ignore */
}
nickEl.addEventListener("input", () => {
  try {
    localStorage.setItem("lolmatch:nick", nickEl.value);
  } catch (_) {
    /* ignore */
  }
});

fillOptions(tierEl, TIERS);
fillOptions(queueEl, QUEUES);
function fillOptions(sel, pairs) {
  sel.replaceChildren(
    ...pairs.map(([value, label]) => {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      return o;
    }),
  );
}

const socket = io();
let lastState = null;
let lastGameId = null;
let serverSkew = 0; // 서버시각 - 로컬시각

socket.on("connect", () => {
  connEl.textContent = "실시간";
  connEl.classList.add("on");
  socket.emit("join", { roomId });
});
socket.on("disconnect", () => {
  connEl.textContent = "재연결 중…";
  connEl.classList.remove("on");
});
socket.on("state", (state) => {
  if (typeof state.now === "number") serverSkew = state.now - Date.now();
  if (lastGameId !== null && state.gameId !== lastGameId) {
    toast("시간이 지나 새 게임이 열렸어요");
  }
  lastGameId = state.gameId;
  lastState = state;
  render(state);
});
socket.on("roster:error", (err) => toast(err && err.message ? err.message : "오류가 발생했습니다."));

// --- 설정 변경 → 저장 브로드캐스트 ---
tierEl.addEventListener("change", () => socket.emit("settings:update", { tier: tierEl.value, clientId }));
queueEl.addEventListener("change", () => socket.emit("settings:update", { queue: queueEl.value, clientId }));
timeEl.addEventListener("change", () => {
  const scheduledAt = timeEl.value ? new Date(timeEl.value).getTime() : null;
  socket.emit("settings:update", { scheduledAt, clientId });
});

// --- 자리 저장/해제 ---
function claim(position) {
  const nickname = nickEl.value.trim();
  if (!nickname) {
    toast("닉네임을 먼저 입력하세요");
    nickEl.focus();
    return;
  }
  socket.emit("claim", { position, nickname, clientId });
  toast("저장했어요");
}
function release(position) {
  socket.emit("release", { position, clientId });
}

function render(state) {
  const seats = state.seats || {};
  gamenoEl.textContent = String(state.gameId || 1);

  // 설정 컨트롤은 편집 중(포커스)이 아닐 때만 서버값으로 갱신.
  if (document.activeElement !== tierEl) tierEl.value = state.settings.tier;
  if (document.activeElement !== queueEl) queueEl.value = state.settings.queue;
  if (document.activeElement !== timeEl) {
    timeEl.value = state.settings.scheduledAt ? toLocalInput(state.settings.scheduledAt) : "";
  }
  renderDeadline();

  lanesEl.replaceChildren(
    ...LANES.map((lane) => {
      const seat = seats[lane.id];
      const mine = seat && seat.ownerId === clientId;
      const li = document.createElement("li");
      const row = document.createElement(seat ? "div" : "button");
      row.className = "lane" + (seat ? " lane--filled" : "") + (mine ? " lane--mine" : "");
      if (!seat) {
        row.type = "button";
        row.setAttribute("aria-label", lane.ko + " 자리 저장하기");
        row.addEventListener("click", () => claim(lane.id));
      }
      row.appendChild(iconEl(lane.id));
      row.appendChild(labelEl(lane));
      row.appendChild(slotEl(lane, seat, mine));
      li.appendChild(row);
      return li;
    }),
  );

  const n = typeof state.filled === "number" ? state.filled : 0;
  filledEl.textContent = String(n);
  countEl.classList.toggle("full", n === LANES.length);
}

function renderDeadline() {
  const at = lastState && lastState.settings.scheduledAt;
  if (!at) {
    deadlineEl.hidden = true;
    return;
  }
  const remain = at - (Date.now() + serverSkew);
  deadlineEl.hidden = false;
  const hhmm = new Date(at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  if (remain <= 0) {
    deadlineEl.textContent = "마감 시간 지남 — 곧 새 게임이 열립니다";
    deadlineEl.classList.add("soon");
  } else {
    const mins = Math.ceil(remain / 60000);
    deadlineEl.textContent = `마감 ${hhmm} · ${mins > 60 ? Math.floor(mins / 60) + "시간 " : ""}${mins % 60}분 남음`;
    deadlineEl.classList.toggle("soon", mins <= 5);
  }
}
setInterval(renderDeadline, 30000);

function iconEl(id) {
  const span = document.createElement("span");
  span.className = "lane__icon";
  span.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    ICONS[id] +
    "</svg>";
  return span;
}
function labelEl(lane) {
  const wrap = document.createElement("span");
  wrap.className = "lane__label";
  const ko = document.createElement("span");
  ko.className = "lane__ko";
  ko.textContent = lane.ko;
  const en = document.createElement("span");
  en.className = "lane__en";
  en.textContent = lane.en;
  wrap.append(ko, en);
  return wrap;
}
function slotEl(lane, seat, mine) {
  const slot = document.createElement("span");
  slot.className = "lane__slot";
  if (seat) {
    const who = document.createElement("span");
    who.className = "lane__who";
    who.textContent = seat.nickname;
    slot.appendChild(who);
    if (mine) {
      const x = document.createElement("button");
      x.type = "button";
      x.className = "lane__x";
      x.setAttribute("aria-label", lane.ko + " 자리 비우기");
      x.textContent = "✕";
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        release(lane.id);
      });
      slot.appendChild(x);
    }
  } else {
    const pick = document.createElement("span");
    pick.className = "lane__pick";
    pick.textContent = "＋ 저장";
    slot.appendChild(pick);
  }
  return slot;
}

function toLocalInput(epoch) {
  const d = new Date(epoch);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let toastT;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove("show"), 1800);
}

$("#copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    toast("링크를 복사했어요 — 오픈채팅방에 붙여넣기");
  } catch (_) {
    toast("복사 실패 — 주소창 링크를 직접 공유하세요");
  }
});
$("#newroom").addEventListener("click", () => {
  const code = Math.random().toString(36).slice(2, 8);
  location.search = "?room=" + code;
});
nickEl.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !lastState) return;
  const empty = LANES.find((l) => !lastState.seats[l.id]);
  if (empty) claim(empty.id);
});
