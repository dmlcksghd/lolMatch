/* LOLMatch client — 파티 목록/상세, 라인 다중 선택 참가, 실시간 저장, 반응형. */
(() => {
  "use strict";

  const MAX = 5;
  const YEAR_MS = 365 * 24 * 60 * 60 * 1000; // 예정 시간 상한(약 1년)
  const LANES = [
    { key: "TOP", label: "탑" },
    { key: "JGL", label: "정글" },
    { key: "MID", label: "미드" },
    { key: "ADC", label: "원딜" },
    { key: "SUP", label: "서폿" },
  ];
  const QUEUES = [
    ["NORMAL", "일반게임"],
    ["ARAM", "칼바람"],
    ["SOLO", "솔로랭크"],
    ["FLEX", "자유랭크"],
    ["FLEX5", "5인 자유랭"],
    ["OTHER", "기타"],
  ];
  const TIERS = [
    ["ANY", "상관없음"],
    ["IRON", "아이언"],
    ["BRONZE", "브론즈"],
    ["SILVER", "실버"],
    ["GOLD", "골드"],
    ["PLATINUM", "플래티넘"],
    ["EMERALD", "에메랄드"],
    ["DIAMOND", "다이아"],
    ["MASTER", "마스터"],
    ["GRANDMASTER", "그마"],
    ["CHALLENGER", "챌린저"],
  ];

  const $ = (id) => document.getElementById(id);
  const laneLabel = (k) => (LANES.find((l) => l.key === k) || {}).label || k;
  const queueLabel = (q) => (QUEUES.find((x) => x[0] === q) || [])[1] || q;
  const tierLabel = (t) => (TIERS.find((x) => x[0] === t) || [])[1] || t;
  const usesPositions = (q) => q !== "ARAM";
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // 연도 없이 월/일 + 오전·오후 시:분 (예: 7/9 오후 8:30)
  function fmtWhen(ms) {
    const d = new Date(ms);
    const h = d.getHours();
    const ampm = h < 12 ? "오전" : "오후";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${d.getMonth() + 1}/${d.getDate()} ${ampm} ${h12}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function toLocalInput(ms) {
    const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  }
  function fromLocalInput(v) {
    if (!v) return null;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  }
  function setTimeBounds(input) {
    const base = Date.now();
    input.min = toLocalInput(base);
    input.max = toLocalInput(base + YEAR_MS);
  }
  // 비면 null, 위반이면 false, 유효하면 ms
  function readTimeFrom(input) {
    const raw = input.value;
    if (!raw) return null;
    if (typeof input.checkValidity === "function" && !input.checkValidity()) {
      toast("시간이 올바르지 않아요 (지금~1년 이내)");
      return false;
    }
    const at = fromLocalInput(raw);
    if (at === null) {
      toast("시간 형식이 올바르지 않아요");
      return false;
    }
    if (at <= Date.now()) {
      toast("미래 시각을 선택하세요");
      return false;
    }
    if (at > Date.now() + YEAR_MS) {
      toast("너무 먼 시간이에요 (1년 이내로)");
      return false;
    }
    return at;
  }

  // 클라이언트 신원 & 닉네임(로컬 저장)
  function getClientId() {
    let id = localStorage.getItem("lolmatch:cid");
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : "c-" + Math.random().toString(36).slice(2) + Date.now();
      localStorage.setItem("lolmatch:cid", id);
    }
    return id;
  }
  const clientId = getClientId();

  function shortCode() {
    const abc = "abcdefghijkmnpqrstuvwxyz23456789";
    let out = "";
    for (let i = 0; i < 6; i++) out += abc[Math.floor(Math.random() * abc.length)];
    return out;
  }
  function currentRoom() {
    const url = new URL(location.href);
    let r = url.searchParams.get("room");
    if (!r) {
      // 맨 URL 접속이면 마지막에 쓰던 방으로 복귀(없으면 새 방 생성)
      r = localStorage.getItem("lolmatch:room") || shortCode();
      url.searchParams.set("room", r);
      history.replaceState(null, "", url);
    }
    localStorage.setItem("lolmatch:room", r);
    return r;
  }
  const room = currentRoom();

  // 요소
  const nickInput = $("nick");
  const listView = $("view-list");
  const detailView = $("view-detail");
  const partyList = $("party-list");
  const emptyMsg = $("empty");
  const rosterEl = $("detail-roster");
  const deadlineEl = $("deadline");
  const leaveBtn = $("leave");
  const toastEl = $("toast");
  const joinPanel = $("join-panel");

  nickInput.value = localStorage.getItem("lolmatch:nick") || "";
  nickInput.addEventListener("input", () => localStorage.setItem("lolmatch:nick", nickInput.value.trim()));
  const nick = () => nickInput.value.trim();
  function requireNick() {
    if (nick()) return true;
    toast("닉네임을 먼저 입력하세요");
    nickInput.focus();
    return false;
  }

  // 셀렉트 옵션
  function fillSelect(el, pairs) {
    el.innerHTML = pairs.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  }
  fillSelect($("c-queue"), QUEUES);
  fillSelect($("c-tier"), TIERS);
  fillSelect($("d-queue"), QUEUES);
  fillSelect($("d-tier"), TIERS);
  $("c-queue").value = "SOLO";
  $("c-tier").value = "ANY";
  setTimeBounds($("c-time"));
  setTimeBounds($("d-time"));

  // 라인 다중 선택 토글
  const createSel = new Set();
  let detailSel = new Set();
  let panelPartyId = null;

  function buildLaneToggles(container) {
    container.innerHTML =
      LANES.map((l) => `<button type="button" class="lane-toggle" data-lane="${l.key}">${l.label}</button>`).join("") +
      `<button type="button" class="lane-toggle lane-toggle--all" data-lane="ALL">ALL</button>`;
  }
  function paintLaneToggles(container, sel) {
    const all = LANES.every((l) => sel.has(l.key));
    container.querySelectorAll("[data-lane]").forEach((b) => {
      const lane = b.getAttribute("data-lane");
      b.classList.toggle("on", lane === "ALL" ? all : sel.has(lane));
    });
  }
  function wireLanePick(container, sel) {
    container.addEventListener("click", (e) => {
      const b = e.target.closest("[data-lane]");
      if (!b) return;
      const lane = b.getAttribute("data-lane");
      if (lane === "ALL") {
        if (LANES.every((l) => sel.has(l.key))) sel.clear();
        else LANES.forEach((l) => sel.add(l.key));
      } else if (sel.has(lane)) {
        sel.delete(lane);
      } else {
        sel.add(lane);
      }
      paintLaneToggles(container, sel);
    });
  }
  buildLaneToggles($("c-lanes"));
  buildLaneToggles($("d-lanes"));
  wireLanePick($("c-lanes"), createSel);
  wireLanePick($("d-lanes"), detailSel);

  // 상태 & 뷰
  let state = { parties: [] };
  let view = { name: "list" };
  let pendingEnter = false;
  history.replaceState({ name: "list" }, "");

  function enterParty(id) {
    view = { name: "detail", partyId: id };
    history.pushState(view, "");
    render();
  }
  window.addEventListener("popstate", (e) => {
    view = e.state && e.state.name === "detail" ? { name: "detail", partyId: e.state.partyId } : { name: "list" };
    if (view.name !== "detail") panelPartyId = null;
    render();
  });
  $("back").addEventListener("click", () => history.back());

  // 소켓
  const socket = io();
  const conn = $("conn");
  socket.on("connect", () => {
    conn.textContent = "실시간";
    conn.dataset.on = "1";
    socket.emit("join", { roomId: room });
  });
  socket.on("disconnect", () => {
    conn.textContent = "연결 끊김";
    conn.dataset.on = "0";
  });
  socket.on("room:state", (dto) => {
    state = dto || { parties: [] };
    if (pendingEnter) {
      const mine = [...state.parties].reverse().find((p) => p.members.some((m) => m.clientId === clientId));
      if (mine) {
        pendingEnter = false;
        enterParty(mine.id);
        return;
      }
    }
    render();
  });
  socket.on("party:error", (e) => {
    pendingEnter = false;
    toast(errText(e));
  });

  function errText(e) {
    const map = {
      PARTY_FULL: "파티가 가득 찼어요 (최대 5명)",
      PARTY_NOT_FOUND: "파티를 찾을 수 없어요",
      INVALID_NICKNAME: "닉네임은 1~16자여야 해요",
      INVALID_POSITION: "라인을 하나 이상 선택하세요",
      INVALID_TIME: "시간이 올바르지 않아요",
      INVALID_TIER: "티어 값이 올바르지 않아요",
      INVALID_QUEUE: "큐 값이 올바르지 않아요",
      NO_CLIENT: "브라우저 정보를 읽지 못했어요",
      NO_ROOM: "방 정보가 없어요",
    };
    return (e && map[e.code]) || (e && e.message) || "요청을 처리하지 못했어요";
  }

  const myMember = (p) => p.members.find((m) => m.clientId === clientId) || null;

  // 렌더
  function render() {
    $("roomcode").textContent = room;
    const parties = state.parties || [];
    if (view.name === "detail" && !parties.some((p) => p.id === view.partyId)) {
      view = { name: "list" };
      panelPartyId = null;
      history.replaceState(view, "");
      toast("파티가 종료되었어요");
    }
    listView.hidden = view.name !== "list";
    detailView.hidden = view.name !== "detail";
    if (view.name === "list") renderList(parties);
    else renderDetail(parties.find((p) => p.id === view.partyId));
  }

  function memberPreview(p) {
    if (!p.members.length) return "비어 있음";
    return p.members
      .map((m) => (m.positions.length ? `${m.positions.map(laneLabel).join("/")} ${esc(m.nickname)}` : esc(m.nickname)))
      .join(" · ");
  }

  function renderList(parties) {
    $("party-count").textContent = String(parties.length);
    emptyMsg.hidden = parties.length > 0;
    partyList.innerHTML = parties
      .map((p) => {
        const when = p.settings.scheduledAt ? fmtWhen(p.settings.scheduledAt) : "시간 미정";
        const full = p.count >= MAX;
        return `
        <li class="party">
          <button class="party__open" data-open="${p.id}" type="button">
            <div class="party__row">
              <span class="q q--${p.settings.queue}">${queueLabel(p.settings.queue)}</span>
              <span class="tier">${tierLabel(p.settings.tier)}</span>
              <span class="party__count ${full ? "is-full" : ""}"><b>${p.count}</b>/${MAX}</span>
            </div>
            <div class="party__when">🕑 ${when}</div>
            <div class="party__who">${memberPreview(p)}</div>
          </button>
        </li>`;
      })
      .join("");
  }

  function renderDetail(p) {
    if (!p) return;
    const positional = usesPositions(p.settings.queue);
    const me = myMember(p);

    $("detail-meta").innerHTML = `<b>${queueLabel(p.settings.queue)}</b> · ${tierLabel(p.settings.tier)}`;
    setIfIdle($("d-queue"), p.settings.queue);
    setIfIdle($("d-tier"), p.settings.tier);
    setTimeBounds($("d-time"));
    if (document.activeElement !== $("d-time"))
      $("d-time").value = p.settings.scheduledAt ? toLocalInput(p.settings.scheduledAt) : "";

    if (p.settings.scheduledAt) {
      deadlineEl.hidden = false;
      deadlineEl.textContent = `⏳ ${fmtWhen(p.settings.scheduledAt)} 까지 모집`;
    } else {
      deadlineEl.hidden = true;
    }

    // 참가 패널: 이 파티에 처음 들어왔을 때만 내 현재 선택으로 초기화(편집 중 덮어쓰기 방지)
    if (panelPartyId !== p.id) {
      panelPartyId = p.id;
      detailSel = new Set(me ? me.positions : []);
      wireLanePick($("d-lanes"), detailSel);
    }
    const full = p.count >= MAX && !me;
    $("d-lanes").hidden = !positional;
    $("join-label").hidden = !positional;
    paintLaneToggles($("d-lanes"), detailSel);
    const goBtn = $("join-go");
    if (positional) {
      goBtn.textContent = me ? "내 라인 저장" : "참가하기";
      goBtn.disabled = full;
    } else {
      goBtn.textContent = me ? "참가 완료" : "참가하기";
      goBtn.disabled = full || Boolean(me);
    }
    joinPanel.dataset.full = full ? "1" : "0";

    rosterEl.innerHTML = positional ? laneRoster(p) : aramRoster(p);
    $("detail-filled").textContent = String(p.count);
    leaveBtn.hidden = !me;
  }

  function laneRoster(p) {
    return LANES.map((l) => {
      const here = p.members.filter((m) => m.positions.includes(l.key));
      const seats = here.length
        ? here.map((m) => chip(m, l.key)).join("")
        : '<span class="chip chip--ghost">비어 있음</span>';
      return `
      <div class="lane">
        <div class="lane__id"><span>${l.label}</span></div>
        <div class="lane__seats">${seats}</div>
      </div>`;
    }).join("");
  }

  function aramRoster(p) {
    const seats = p.members
      .map((m) => (m.clientId === clientId ? myChip(m.nickname, "aram") : `<span class="chip">${esc(m.nickname)}</span>`))
      .join("");
    return `<div class="aram"><div class="aram__seats">${seats || '<span class="chip chip--ghost">아직 아무도 없어요</span>'}</div></div>`;
  }

  function chip(m, lane) {
    return m.clientId === clientId
      ? myChip(m.nickname, lane)
      : `<span class="chip">${esc(m.nickname)}</span>`;
  }
  function myChip(nickname, lane) {
    return `<button class="chip chip--mine" data-drop="${lane}" type="button" title="이 라인에서 빼기">${esc(nickname)} ✕</button>`;
  }

  function setIfIdle(sel, value) {
    if (document.activeElement !== sel) sel.value = value;
  }

  // 상세 상호작용
  rosterEl.addEventListener("click", (e) => {
    const p = state.parties.find((x) => x.id === view.partyId);
    if (!p) return;
    const dropEl = e.target.closest("[data-drop]");
    if (!dropEl) return;
    const me = myMember(p);
    if (!me) return;
    const lane = dropEl.getAttribute("data-drop");
    if (lane === "aram") {
      socket.emit("party:leave", { partyId: p.id, clientId });
      detailSel = new Set();
      return;
    }
    const next = me.positions.filter((x) => x !== lane);
    detailSel = new Set(next);
    if (next.length === 0) socket.emit("party:leave", { partyId: p.id, clientId });
    else socket.emit("party:join", { partyId: p.id, clientId, nickname: nick() || me.nickname, positions: next });
  });

  $("join-go").addEventListener("click", () => {
    const p = state.parties.find((x) => x.id === view.partyId);
    if (!p || !requireNick()) return;
    const payload = { partyId: p.id, clientId, nickname: nick() };
    if (usesPositions(p.settings.queue)) {
      if (detailSel.size === 0) return toast("갈 라인을 선택하세요");
      payload.positions = [...detailSel];
    } else {
      payload.positions = [];
    }
    socket.emit("party:join", payload);
  });

  leaveBtn.addEventListener("click", () => {
    const p = state.parties.find((x) => x.id === view.partyId);
    if (p) {
      socket.emit("party:leave", { partyId: p.id, clientId });
      detailSel = new Set();
    }
  });

  // 상세 설정 변경
  $("d-queue").addEventListener("change", (e) =>
    socket.emit("party:settings", { partyId: view.partyId, clientId, queue: e.target.value }),
  );
  $("d-tier").addEventListener("change", (e) =>
    socket.emit("party:settings", { partyId: view.partyId, clientId, tier: e.target.value }),
  );
  $("d-time").addEventListener("change", (e) => {
    const at = readTimeFrom(e.target);
    if (at === false) return render();
    if (at === null) {
      toast("시간은 비울 수 없어요");
      return render();
    }
    socket.emit("party:settings", { partyId: view.partyId, clientId, scheduledAt: at });
  });

  // 목록: 파티 열기
  partyList.addEventListener("click", (e) => {
    const openEl = e.target.closest("[data-open]");
    if (openEl) enterParty(openEl.getAttribute("data-open"));
  });

  // 새 파티 폼
  const createForm = $("create-form");
  const cQueue = $("c-queue");
  const cPosField = $("c-pos-field");
  function syncCreatePos() {
    cPosField.hidden = !usesPositions(cQueue.value);
  }
  cQueue.addEventListener("change", syncCreatePos);
  syncCreatePos();

  $("new-party").addEventListener("click", () => {
    createForm.hidden = !createForm.hidden;
    if (!createForm.hidden) {
      setTimeBounds($("c-time"));
      createSel.clear();
      paintLaneToggles($("c-lanes"), createSel);
      $("c-queue").focus();
    }
  });
  $("c-cancel").addEventListener("click", () => (createForm.hidden = true));
  createForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!requireNick()) return;
    const queue = cQueue.value;
    const at = readTimeFrom($("c-time"));
    if (at === false) return;
    if (at === null) return toast("시간을 입력하세요");
    const payload = { clientId, nickname: nick(), queue, tier: $("c-tier").value, scheduledAt: at };
    if (usesPositions(queue)) {
      if (createSel.size === 0) return toast("갈 라인을 하나 이상 선택하세요");
      payload.positions = [...createSel];
    } else {
      payload.positions = [];
    }
    pendingEnter = true;
    socket.emit("party:create", payload);
    createForm.hidden = true;
    $("c-time").value = "";
  });

  // 방/링크
  $("newroom").addEventListener("click", () => {
    const url = new URL(location.href);
    url.searchParams.set("room", shortCode());
    location.href = url.toString();
  });
  $("copy").addEventListener("click", async () => {
    const link = location.href;
    try {
      await navigator.clipboard.writeText(link);
      toast("링크를 복사했어요");
    } catch {
      prompt("아래 링크를 복사하세요", link);
    }
  });

  // 토스트
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.dataset.on = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.dataset.on = "0"), 2200);
  }

  render();
})();
