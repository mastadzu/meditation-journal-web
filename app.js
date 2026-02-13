const STORE_KEY = "mj_web_v2";
const DEFAULT_REMINDER = "Напоминаю, что сегодня у тебя медитация в такое-то время!";

const state = {
  sessions: [],
  entries: [],
  reminders: [],
  timer: {
    durationSec: 600,
    remainingSec: 600,
    running: false,
    startedAt: 0,
    endsAt: 0,
    intervalId: null,
    wakeLock: null,
  },
  reminderHits: {},
  currentSessionId: null,
  selectedSessionId: null,
  pendingIntention: "",
  archiveDetailMode: false,
};
const noteEditorBridge = {
  openForEdit: null,
};

function uid() {
  return Date.now() + Math.floor(Math.random() * 1000);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function nowMs() {
  return Date.now();
}

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(ms) {
  return new Date(ms).toLocaleDateString([], {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function fmtDateTime(ms) {
  return new Date(ms).toLocaleString([], {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const SEGMENT_MAP = {
  "0": ["a", "b", "c", "d", "e", "f"],
  "1": ["b", "c"],
  "2": ["a", "b", "g", "e", "d"],
  "3": ["a", "b", "g", "c", "d"],
  "4": ["f", "g", "b", "c"],
  "5": ["a", "f", "g", "c", "d"],
  "6": ["a", "f", "g", "e", "c", "d"],
  "7": ["a", "b", "c"],
  "8": ["a", "b", "c", "d", "e", "f", "g"],
  "9": ["a", "b", "c", "d", "f", "g"],
};

function renderTimerReadout(root, value) {
  if (!root) return;
  if (root.dataset.segValue === value) return;
  root.dataset.segValue = value;
  root.setAttribute("aria-label", value);
  root.innerHTML = "";

  [...value].forEach((char) => {
    if (char === ":") {
      const colon = document.createElement("span");
      colon.className = "seg-colon";
      const dotTop = document.createElement("span");
      dotTop.className = "seg-dot seg-dot-top";
      const dotBottom = document.createElement("span");
      dotBottom.className = "seg-dot seg-dot-bottom";
      colon.appendChild(dotTop);
      colon.appendChild(dotBottom);
      root.appendChild(colon);
      return;
    }

    if (!SEGMENT_MAP[char]) return;

    const digit = document.createElement("span");
    digit.className = "seg-digit";
    ["a", "b", "c", "d", "e", "f", "g"].forEach((segName) => {
      const seg = document.createElement("span");
      seg.className = `seg seg-${segName}${SEGMENT_MAP[char].includes(segName) ? "" : " off"}`;
      digit.appendChild(seg);
    });
    root.appendChild(digit);
  });
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function load() {
  const raw = localStorage.getItem(STORE_KEY) || localStorage.getItem("mj_web_v1");
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    state.sessions = parsed.sessions || [];
    state.entries = (parsed.entries || []).map((e) => ({ ...e, sessionId: e.sessionId ?? null }));
    state.reminders = parsed.reminders || [];
    state.reminderHits = parsed.reminderHits || {};
    if (typeof parsed.timerDurationSec === "number" && parsed.timerDurationSec >= 0) {
      state.timer.durationSec = parsed.timerDurationSec;
      state.timer.remainingSec = parsed.timerDurationSec;
    }
  } catch {
    // ignore
  }
}

function save() {
  localStorage.setItem(
    STORE_KEY,
    JSON.stringify({
      sessions: state.sessions,
      entries: state.entries,
      reminders: state.reminders,
      reminderHits: state.reminderHits,
      timerDurationSec: state.timer.durationSec,
      currentSessionId: state.currentSessionId,
      selectedSessionId: state.selectedSessionId,
      pendingIntention: state.pendingIntention,
    })
  );
}

function switchScreen(target) {
  const app = document.querySelector(".app");
  if (app) {
    app.classList.toggle("home-screen", target === "home");
    app.classList.toggle("hide-header", target !== "home");
    app.classList.toggle("home-flow-bg", target === "home");
    app.classList.toggle("timer-flow-bg", target === "timer" || target === "archive");
  }
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.screen === target));
  positionNavIndicator(target);
  requestAnimationFrame(() => positionNavIndicator(target));
  setTimeout(() => positionNavIndicator(target), 120);

  const current = document.querySelector(".screen.active");
  const next = document.getElementById(`screen-${target}`);
  if (!next || current === next) return;

  if (switchScreen._busy) return;
  switchScreen._busy = true;

  const finish = () => {
    switchScreen._busy = false;
  };

  if (!current || !current.animate || !next.animate) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    next.classList.add("active");
    finish();
    return;
  }

  const out = current.animate(
    [
      { opacity: 1, transform: "translateY(0px)" },
      { opacity: 0, transform: "translateY(4px)" },
    ],
    { duration: 180, easing: "ease", fill: "forwards" }
  );

  out.onfinish = () => {
    current.classList.remove("active");
    current.style.opacity = "";
    current.style.transform = "";

    next.classList.add("active");
    next.animate(
      [
        { opacity: 0, transform: "translateY(4px)" },
        { opacity: 1, transform: "translateY(0px)" },
      ],
      { duration: 220, easing: "ease", fill: "both" }
    ).onfinish = finish;
  };
}

function positionNavIndicator(targetRoute) {
  const nav = document.querySelector(".bottom-nav");
  const indicator = document.getElementById("nav-indicator");
  const activeBtn = targetRoute
    ? document.querySelector(`.nav-btn[data-screen="${targetRoute}"]`)
    : document.querySelector(".nav-btn.active");

  if (!nav || !indicator || !activeBtn) return;

  const navRect = nav.getBoundingClientRect();
  const btnRect = activeBtn.getBoundingClientRect();
  const label = activeBtn.querySelector(".nav-btn-label") || activeBtn;
  const labelRect = label.getBoundingClientRect();

  // Контур зависит от текста: фиксированный симметричный отступ слева/справа.
  const sidePad = 34;
  const maxWidth = Math.max(70, btnRect.width - 10);
  const rawLeft = Math.round(labelRect.left - navRect.left - sidePad);
  const rawWidth = Math.round(labelRect.width + sidePad * 2);
  const indicatorWidth = Math.min(maxWidth, rawWidth);

  const minLeft = 8;
  const maxLeft = navRect.width - indicatorWidth - 8;
  const left = Math.max(minLeft, Math.min(maxLeft, rawLeft));

  indicator.style.transform = `translateX(${left}px)`;
  indicator.style.width = `${indicatorWidth}px`;
}

function renderNav() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.onclick = () => {
      if (btn.dataset.screen === "archive") {
        state.archiveDetailMode = false;
        applyArchiveMode();
      }
      switchScreen(btn.dataset.screen);
    };
  });
  const goMeditation = document.getElementById("go-meditation");
  if (goMeditation) goMeditation.onclick = () => switchScreen("timer");
}

function renderStats() {
  const meditations = state.sessions.filter((s) => s.completed).length;
  const intentions = state.entries.filter((e) => e.type === "INTENTION").length;
  const insights = state.entries.filter((e) => e.type === "INSIGHT").length;
  const ideas = state.entries.filter((e) => e.type === "IDEA").length;

  document.getElementById("stat-meditations").textContent = String(meditations);
  document.getElementById("stat-intentions").textContent = String(intentions);
  document.getElementById("stat-insights").textContent = String(insights);
  document.getElementById("stat-ideas").textContent = String(ideas);

  const dayMeditations = state.sessions.filter((s) => s.completed && s.date === todayStr()).length;
  document.getElementById("today-count").textContent = `Медитаций сегодня: ${dayMeditations}`;
}

function entriesForSession(sessionId) {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return [];
  return state.entries
    .filter((e) => e.sessionId === sessionId || (e.sessionId == null && e.date === session.date))
    .sort((a, b) => a.createdAt - b.createdAt);
}

function typeRu(type) {
  if (type === "INTENTION") return "Намерение";
  if (type === "INSIGHT") return "Инсайт";
  return "Идея";
}

function openSessionInArchive(sessionId) {
  state.currentSessionId = sessionId;
  state.selectedSessionId = sessionId;
  state.archiveDetailMode = true;
  applyArchiveMode();
  save();
  renderSessionDetails();
  switchScreen("archive");
}

function applyArchiveMode() {
  const screen = document.getElementById("screen-archive");
  if (!screen) return;
  screen.classList.toggle("focus-details", Boolean(state.archiveDetailMode));
}

function deleteSessionById(sessionId) {
  state.sessions = state.sessions.filter((s) => s.id !== sessionId);
  state.entries = state.entries.filter((e) => e.sessionId !== sessionId);
  if (state.currentSessionId === sessionId) state.currentSessionId = null;
  if (state.selectedSessionId === sessionId) state.selectedSessionId = null;
  if (state.archiveDetailMode && !state.selectedSessionId) {
    state.archiveDetailMode = false;
    applyArchiveMode();
  }
  save();
  renderAll();
}

function bindSwipeDeleteCard(card, { onDelete, onTap }) {
  const content = card.querySelector(".swipe-content");
  const deleteBtn = card.querySelector(".swipe-delete-btn");
  if (!content || !deleteBtn || typeof onDelete !== "function") return;

  const revealPx = 88;
  const deleteThreshold = 122;
  const revealThreshold = 44;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let axisLocked = "";
  let dragging = false;

  const setOffset = (x, animate = false) => {
    content.style.transition = animate ? "transform 240ms cubic-bezier(0.22, 0.8, 0.2, 1), opacity 220ms ease" : "none";
    content.style.transform = `translateX(${x}px)`;
  };

  const closeReveal = () => {
    card.classList.remove("swipe-open");
    setOffset(0, true);
  };

  const openReveal = () => {
    card.classList.add("swipe-open");
    setOffset(-revealPx, true);
  };

  const runDelete = () => {
    card.classList.add("swipe-deleting");
    content.style.transition = "transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 220ms ease";
    content.style.transform = "translateX(-140%)";
    content.style.opacity = "0";
    setTimeout(() => onDelete(), 230);
  };

  content.addEventListener("pointerdown", (e) => {
    if (e.target.closest("input,button,label,a")) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    lastX = e.clientX;
    axisLocked = "";
    dragging = false;
    if (content.setPointerCapture) content.setPointerCapture(pointerId);
  });

  content.addEventListener("pointermove", (e) => {
    if (pointerId == null || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    lastX = e.clientX;

    if (!axisLocked && (Math.abs(dx) > 7 || Math.abs(dy) > 7)) {
      axisLocked = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (axisLocked !== "x") return;

    dragging = true;
    e.preventDefault();
    const clamped = Math.max(-150, Math.min(20, dx));
    setOffset(clamped < 0 ? clamped : clamped * 0.2);
  });

  content.addEventListener("pointerup", (e) => {
    if (pointerId == null || e.pointerId !== pointerId) return;
    const dx = lastX - startX;
    const wasDragX = axisLocked === "x";
    pointerId = null;
    if (content.releasePointerCapture) content.releasePointerCapture(e.pointerId);

    if (wasDragX) {
      if (dx <= -deleteThreshold) {
        runDelete();
        return;
      }
      if (dx <= -revealThreshold) {
        openReveal();
        return;
      }
      closeReveal();
      return;
    }

    if (card.classList.contains("swipe-open")) {
      closeReveal();
      return;
    }

    if (typeof onTap === "function") onTap();
  });

  content.addEventListener("pointercancel", () => {
    pointerId = null;
    if (!card.classList.contains("swipe-open")) closeReveal();
  });

  deleteBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    runDelete();
  };
}

function bindSwipeToSessionCard(card, sessionId) {
  bindSwipeDeleteCard(card, {
    onDelete: () => deleteSessionById(sessionId),
    onTap: () => openSessionInArchive(sessionId),
  });
}

function renderTodaySessions() {
  const root = document.getElementById("today-sessions");
  root.innerHTML = "";

  const items = state.sessions
    .filter((s) => s.date === todayStr())
    .sort((a, b) => b.startedAt - a.startedAt);

  if (!items.length) {
    root.innerHTML = `<div class="item"><small>Пока нет завершенных сессий.</small></div>`;
    return;
  }

  items.forEach((s) => {
    const linked = state.entries.filter((e) => e.sessionId === s.id).length;

    const div = document.createElement("div");
    div.className = "item swipe-item";
    div.innerHTML = `
      <div class="swipe-action">
        <button type="button" class="swipe-delete-btn" aria-label="Удалить медитацию">
          <span class="trash-icon" aria-hidden="true"></span>
        </button>
      </div>
      <div class="swipe-content">
        <div class="top">
          <strong>${fmtTime(s.startedAt)} • ${formatDuration(s.durationSec)}</strong>
          <span class="inline session-status session-status-static"><span class="status-check">✓</span>выполнено</span>
        </div>
        <small>записей: ${linked}</small>
      </div>
    `;

    bindSwipeToSessionCard(div, s.id);

    root.appendChild(div);
  });
}

function bindTimer() {
  const MAX_SECONDS = 6 * 60 * 60;
  const readoutBtn = document.getElementById("timer-readout-btn");
  const readout = document.getElementById("timer-readout");
  const progress = document.getElementById("timer-progress");
  const modal = document.getElementById("timer-input-modal");
  const inputHours = document.getElementById("timer-hours");
  const inputMinutes = document.getElementById("timer-minutes");
  const inputSeconds = document.getElementById("timer-seconds");
  const cancelBtn = document.getElementById("timer-input-cancel");
  const saveBtn = document.getElementById("timer-input-save");

  async function requestWakeLock() {
    if (!("wakeLock" in navigator) || !state.timer.running) return;
    try {
      if (!state.timer.wakeLock) state.timer.wakeLock = await navigator.wakeLock.request("screen");
    } catch {
      // ignore unsupported or denied
    }
  }

  async function releaseWakeLock() {
    try {
      if (state.timer.wakeLock) await state.timer.wakeLock.release();
    } catch {
      // ignore
    }
    state.timer.wakeLock = null;
  }

  function paintTimer() {
    const done = state.timer.durationSec <= 0
      ? 0
      : Math.max(0, Math.min(1, 1 - state.timer.remainingSec / state.timer.durationSec));
    renderTimerReadout(readout, formatDuration(Math.max(0, state.timer.remainingSec)));
    progress.style.width = `${Math.round(done * 100)}%`;
  }

  function setDurationSec(seconds) {
    const safe = Math.max(0, Math.min(MAX_SECONDS, Math.floor(Number(seconds) || 0)));
    state.timer.durationSec = safe;
    if (!state.timer.running) state.timer.remainingSec = safe;
    save();
    paintTimer();
  }

  function fillTimerInputsFromState() {
    const total = Math.max(0, state.timer.durationSec);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    inputHours.value = String(h);
    inputMinutes.value = String(m);
    inputSeconds.value = String(s);
  }

  function openTimerModal() {
    if (state.timer.running) return;
    fillTimerInputsFromState();
    modal.classList.remove("hidden-block");
    inputMinutes.focus();
    inputMinutes.select();
  }

  function closeTimerModal() {
    modal.classList.add("hidden-block");
  }

  function saveTimerFromInputs() {
    const h = Math.max(0, Math.min(6, Number.parseInt(inputHours.value || "0", 10) || 0));
    const m = Math.max(0, Math.min(59, Number.parseInt(inputMinutes.value || "0", 10) || 0));
    const s = Math.max(0, Math.min(59, Number.parseInt(inputSeconds.value || "0", 10) || 0));
    const total = Math.min(MAX_SECONDS, h * 3600 + m * 60 + s);
    setDurationSec(total);
    closeTimerModal();
  }

  function syncTimerWithNow() {
    if (!state.timer.running) return;
    const left = Math.max(0, Math.ceil((state.timer.endsAt - nowMs()) / 1000));
    state.timer.remainingSec = left;
    paintTimer();
    if (left <= 0) finishMeditation();
  }

  document.getElementById("btn-start").onclick = () => {
    if (state.timer.running) return;

    const startedAt = nowMs();
    const sessionId = uid();
    state.sessions.push({
      id: sessionId,
      date: todayStr(),
      startedAt,
      finishedAt: startedAt + state.timer.durationSec * 1000,
      durationSec: state.timer.durationSec,
      completed: true,
      manuallyUnchecked: false,
    });

    state.currentSessionId = sessionId;
    state.selectedSessionId = sessionId;

    if (state.pendingIntention.trim()) {
      state.entries.push({
        id: uid(),
        createdAt: startedAt,
        date: todayStr(),
        sessionId,
        type: "INTENTION",
        text: state.pendingIntention.trim(),
      });
      state.pendingIntention = "";
    }

    save();
    renderAll();

    state.timer.running = true;
    state.timer.startedAt = startedAt;
    state.timer.endsAt = startedAt + state.timer.durationSec * 1000;
    state.timer.intervalId = setInterval(syncTimerWithNow, 250);
    requestWakeLock();
    syncTimerWithNow();
  };

  document.getElementById("btn-reset").onclick = () => {
    clearInterval(state.timer.intervalId);
    state.timer.running = false;
    state.timer.startedAt = 0;
    state.timer.endsAt = 0;
    state.timer.remainingSec = state.timer.durationSec;
    releaseWakeLock();
    paintTimer();
  };

  readoutBtn.onclick = openTimerModal;
  cancelBtn.onclick = closeTimerModal;
  saveBtn.onclick = saveTimerFromInputs;
  modal.onclick = (e) => {
    if (e.target === modal) closeTimerModal();
  };

  [inputHours, inputMinutes, inputSeconds].forEach((el) => {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveTimerFromInputs();
      }
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (!state.timer.running) return;
    if (document.visibilityState === "visible") requestWakeLock();
    syncTimerWithNow();
  });
  window.addEventListener("focus", syncTimerWithNow);

  paintTimer();
}

function finishMeditation() {
  if (!state.timer.running) return;
  clearInterval(state.timer.intervalId);
  state.timer.running = false;
  state.timer.startedAt = 0;
  state.timer.endsAt = 0;
  if (state.timer.wakeLock) {
    state.timer.wakeLock.release().catch(() => {});
    state.timer.wakeLock = null;
  }
  state.timer.remainingSec = 0;
  playSoftBell();
  state.timer.remainingSec = state.timer.durationSec;
  renderAll();
}

function playSoftBell() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.connect(ctx.destination);

    const pulseEvery = 0.75;
    const pulseLen = 0.62;
    const total = 15.0;
    const lastPulseIndex = Math.floor(total / pulseEvery);
    const pulses = lastPulseIndex + 1;

    for (let i = 0; i < pulses; i += 1) {
      const start = ctx.currentTime + i * pulseEvery;
      if (start > ctx.currentTime + total) break;

      const osc = ctx.createOscillator();
      const tone = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(432, start);

      const distanceToEnd = lastPulseIndex - i;
      let peak = 0.2704;
      if (distanceToEnd === 2) peak = 0.221;
      if (distanceToEnd === 1) peak = 0.169;
      if (distanceToEnd === 0) peak = 0.117;

      tone.gain.setValueAtTime(0.0001, start);
      tone.gain.exponentialRampToValueAtTime(peak, start + 0.04);
      tone.gain.exponentialRampToValueAtTime(Math.max(0.055, peak * 0.55), start + pulseLen * 0.72);
      tone.gain.exponentialRampToValueAtTime(0.0001, start + pulseLen);

      osc.connect(tone).connect(master);
      osc.start(start);
      osc.stop(start + pulseLen + 0.02);
    }

    master.gain.exponentialRampToValueAtTime(0.338, ctx.currentTime + 0.06);
    master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + total + 1.0);
  } catch {
    // ignore
  }
}

function addEntry(type, text) {
  const value = (text || "").trim();
  if (!value) return;

  const targetSession =
    state.currentSessionId ??
    state.sessions
      .filter((s) => s.date === todayStr())
      .sort((a, b) => b.startedAt - a.startedAt)[0]?.id ??
    null;

  state.entries.push({
    id: uid(),
    createdAt: nowMs(),
    date: todayStr(),
    sessionId: targetSession,
    type,
    text: value,
  });
  save();
  renderAll();
}

function getCurrentSessionForNotes() {
  return (
    state.sessions.find((s) => s.id === state.currentSessionId) ||
    state.sessions
      .filter((s) => s.date === todayStr())
      .sort((a, b) => b.startedAt - a.startedAt)[0] ||
    null
  );
}

function saveIntention(text) {
  const value = (text || "").trim();
  if (!value) return;

  const session = getCurrentSessionForNotes();
  const hasSession = Boolean(session);

  if (hasSession) {
    const existing = state.entries.find(
      (e) => e.type === "INTENTION" && e.sessionId === session.id
    );
    if (existing) {
      existing.text = value;
      existing.createdAt = nowMs();
      save();
      renderAll();
    } else {
      addEntry("INTENTION", value);
    }
    state.pendingIntention = "";
  } else {
    state.pendingIntention = value;
    save();
  }
}

function clearIntention() {
  const session = getCurrentSessionForNotes();
  state.pendingIntention = "";

  if (session) {
    state.entries = state.entries.filter(
      (e) => !(e.type === "INTENTION" && e.sessionId === session.id)
    );
  }

  save();
  renderAll();
}

function bindMeditationNotes() {
  const editor = document.getElementById("note-editor");
  const title = document.getElementById("note-editor-title");
  const hint = document.getElementById("note-editor-hint");
  const input = document.getElementById("note-editor-input");
  const clearBtn = document.getElementById("note-clear");
  const saveBtn = document.getElementById("note-save");
  const cancelBtn = document.getElementById("note-cancel");
  let activeType = null;
  let activeEditEntryId = null;

  function hasPersistedIntention() {
    const session = getCurrentSessionForNotes();
    if (!session) return false;
    return state.entries.some((e) => e.type === "INTENTION" && e.sessionId === session.id);
  }

  function syncClearButtonState() {
    if (!clearBtn) return;
    const hasInputText = input.value.trim().length > 0;
    const hasStoredText = activeType === "INTENTION" && (state.pendingIntention.trim().length > 0 || hasPersistedIntention());
    clearBtn.disabled = !(hasInputText || hasStoredText);
  }

  function openEditor(type, options = {}) {
    const { entryId = null, initialText = "" } = options;
    activeType = type;
    activeEditEntryId = entryId;
    if (type === "INTENTION") {
      const session = getCurrentSessionForNotes();
      const existing = session
        ? state.entries
            .filter((e) => e.type === "INTENTION" && e.sessionId === session.id)
            .sort((a, b) => b.createdAt - a.createdAt)[0]
        : null;
      title.textContent = "Моё намерение";
      hint.textContent = "Здесь вы можете записать намерение перед тем, как начать медитировать.";
      input.placeholder = "Намерение перед медитацией";
      input.value = state.pendingIntention || existing?.text || "";
    } else if (type === "INSIGHT") {
      title.textContent = "Мои инсайты";
      hint.textContent = "Здесь вы можете записать ваши инсайты, которые пришли во время или сразу после медитации.";
      input.placeholder = "Инсайты по текущей медитации";
      input.value = initialText || "";
    } else {
      title.textContent = "Мои идеи";
      hint.textContent = "Здесь вы можете зафиксировать ваши идеи, которые пришли к вам после медитации в течение дня.";
      input.placeholder = "Ценные идеи после медитации для вашей жизни, работы и творчества";
      input.value = initialText || "";
    }
    if (entryId && type === "INSIGHT") {
      title.textContent = "Редактировать инсайт";
    }
    if (entryId && type === "IDEA") {
      title.textContent = "Редактировать идею";
    }
    syncClearButtonState();
    editor.classList.remove("hidden-block");
    input.focus();
  }

  function closeEditor() {
    editor.classList.add("hidden-block");
    activeType = null;
    activeEditEntryId = null;
    input.value = "";
    syncClearButtonState();
  }

  document.getElementById("toggle-intention").onclick = () => openEditor("INTENTION");
  document.getElementById("toggle-insight").onclick = () => openEditor("INSIGHT");
  document.getElementById("toggle-idea").onclick = () => openEditor("IDEA");
  noteEditorBridge.openForEdit = ({ entryId, type, text }) => openEditor(type, { entryId, initialText: text });

  if (clearBtn) {
    clearBtn.onclick = () => {
      if (clearBtn.disabled || !activeType) return;
      const ok = window.confirm("Очистить текст? Это действие нельзя отменить.");
      if (!ok) return;

      if (activeType === "INTENTION") {
        clearIntention();
      }
      input.value = "";
      syncClearButtonState();
      input.focus();
    };
  }

  saveBtn.onclick = () => {
    if (!activeType) return;
    const text = input.value.trim();

    if (activeType === "INTENTION") {
      if (text) {
        saveIntention(text);
      } else {
        clearIntention();
      }
    } else {
      if (!text) {
        closeEditor();
        return;
      }
      if (activeEditEntryId) {
        const entry = state.entries.find((e) => e.id === activeEditEntryId);
        if (entry) {
          entry.text = text;
          save();
          renderAll();
        }
      } else {
        addEntry(activeType, text);
      }
    }
    closeEditor();
  };

  cancelBtn.onclick = () => closeEditor();
  input.addEventListener("input", syncClearButtonState);
  editor.onclick = (e) => {
    if (e.target === editor) closeEditor();
  };
}

function renderArchive() {
  const root = document.getElementById("archive-list");
  root.innerHTML = "";

  const monthMap = new Map();
  state.sessions.forEach((s) => {
    const d = new Date(s.startedAt);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    if (!monthMap.has(key)) monthMap.set(key, []);
    monthMap.get(key).push(s);
  });

  const keys = Array.from(monthMap.keys()).sort((a, b) => {
    const [ay, am] = a.split("-").map(Number);
    const [by, bm] = b.split("-").map(Number);
    return ay === by ? bm - am : by - ay;
  });

  if (!keys.length) {
    root.innerHTML = `<div class="item"><small>Архив пока пустой.</small></div>`;
    return;
  }

  keys.forEach((key) => {
    const [y, m] = key.split("-").map(Number);
    const monthLabel = new Date(y, m - 1, 1).toLocaleString("ru-RU", { month: "long", year: "numeric" });
    const monthSessions = monthMap.get(key).sort((a, b) => b.startedAt - a.startedAt);

    const wrapper = document.createElement("div");
    wrapper.className = "item";
    wrapper.innerHTML = `<strong>${monthLabel.toUpperCase()}</strong><small> медитаций: ${monthSessions.length}</small>`;

    const sessionList = document.createElement("div");
    sessionList.className = "list nested";

    monthSessions.forEach((s) => {
      const notesCount = state.entries.filter((e) => e.sessionId === s.id).length;
      const btn = document.createElement("button");
      btn.className = "session-btn";
      btn.textContent = `${fmtDateTime(s.startedAt)} • ${formatDuration(s.durationSec)} • записей ${notesCount}`;
      btn.onclick = () => {
        state.selectedSessionId = s.id;
        save();
        renderSessionDetails();
      };
      sessionList.appendChild(btn);
    });

    wrapper.appendChild(sessionList);
    root.appendChild(wrapper);
  });
}

function renderSessionDetails() {
  const root = document.getElementById("session-details");
  root.innerHTML = "";

  const session = state.sessions.find((s) => s.id === state.selectedSessionId);
  if (!session) {
    root.innerHTML = `<div class="item"><small>Выбери медитацию в архиве.</small></div>`;
    return;
  }

  const notes = entriesForSession(session.id);
  const header = document.createElement("div");
  header.className = "item";
  header.innerHTML = `
      <div class="top">
        <strong class="detail-headline">
          <span>Медитация выполнена:</span>
          <span class="detail-value">${fmtDate(session.startedAt)}, в ${fmtTime(session.startedAt)}</span>
        </strong>
      </div>
      <small>Длительность медитации: ${formatDuration(session.durationSec)}</small>
    `;
  root.appendChild(header);

  if (!notes.length) {
    root.innerHTML += `<div class="item"><small>Для этой медитации записей нет.</small></div>`;
    return;
  }

  notes.forEach((n) => {
    const div = document.createElement("div");
    div.className = "item swipe-item";
    const noteCopyText = `${typeRu(n.type)} | ${fmtDateTime(n.createdAt)}\n${n.text}`;
    div.innerHTML = `
      <div class="swipe-action">
        <button type="button" class="swipe-delete-btn" aria-label="Удалить запись">
          <span class="trash-icon" aria-hidden="true"></span>
        </button>
      </div>
      <div class="swipe-content">
        <div class="top">
          <strong>${typeRu(n.type)}</strong>
          <div class="inline note-actions">
            ${(n.type === "INSIGHT" || n.type === "IDEA")
              ? `<button class="ghost edit-btn" type="button" aria-label="Редактировать">Редактировать</button>`
              : ""}
            <button class="ghost copy-btn" type="button" aria-label="Копировать">⎘</button>
          </div>
        </div>
        <p>${escapeHtml(n.text)}</p>
        <small>${fmtDateTime(n.createdAt)}</small>
      </div>
    `;
    const editBtn = div.querySelector(".edit-btn");
    if (editBtn) {
      editBtn.onclick = () => {
        if (!noteEditorBridge.openForEdit) return;
        noteEditorBridge.openForEdit({
          entryId: n.id,
          type: n.type,
          text: n.text,
        });
      };
    }
    const copyBtn = div.querySelector(".copy-btn");
    if (copyBtn) {
      copyBtn.onclick = () => copyToClipboard(noteCopyText, copyBtn);
    }
    bindSwipeDeleteCard(div, {
      onDelete: () => {
        state.entries = state.entries.filter((e) => e.id !== n.id);
        save();
        renderAll();
      },
    });
    root.appendChild(div);
  });
}

async function copyToClipboard(text, button) {
  if (!text) return;
  const original = button ? button.textContent : "";
  try {
    await navigator.clipboard.writeText(text);
    if (button) button.textContent = "✓";
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    if (button) button.textContent = "✓";
  } finally {
    if (button) {
      setTimeout(() => {
        button.textContent = original || "Копировать";
      }, 900);
    }
  }
}

function bindReminders() {
  const modal = document.getElementById("reminder-modal");
  const toggle = document.getElementById("toggle-reminders");
  const closeBtn = document.getElementById("reminder-close");
  const notifyState = document.getElementById("notify-state");

  toggle.onclick = () => modal.classList.remove("hidden-block");
  closeBtn.onclick = () => modal.classList.add("hidden-block");
  modal.onclick = (e) => {
    if (e.target === modal) modal.classList.add("hidden-block");
  };

  const canNotify = "Notification" in window;
  if (!canNotify) {
    notifyState.textContent = "Браузер не поддерживает уведомления.";
  } else if (Notification.permission === "granted") {
    notifyState.textContent = "Уведомления включены.";
  } else if (Notification.permission === "denied") {
    notifyState.textContent = "Уведомления отключены в браузере.";
  } else {
    notifyState.textContent = "Разреши уведомления после добавления.";
  }

  document.getElementById("add-reminder").onclick = async () => {
    const time = document.getElementById("reminder-time").value || "08:00";
    const input = document.getElementById("reminder-label");
    const label = input.value.trim() || DEFAULT_REMINDER;

    if (canNotify && Notification.permission === "default") {
      await Notification.requestPermission();
    }

    state.reminders.push({ id: uid(), time, label, enabled: true });
    input.value = "";
    save();
    renderReminders();
  };

  setInterval(checkReminderTick, 30000);
}

function bindAboutModal() {
  const trigger = document.getElementById("about-trigger");
  const modal = document.getElementById("about-modal");
  const closeBtn = document.getElementById("about-close");
  if (!trigger || !modal || !closeBtn) return;

  const open = () => modal.classList.remove("hidden-block");
  const close = () => modal.classList.add("hidden-block");

  trigger.onclick = open;
  trigger.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  };
  closeBtn.onclick = close;
}

function bindButtonSpring() {
  document.addEventListener(
    "pointerdown",
    (e) => {
      const btn = e.target.closest("button");
      if (!btn || btn.disabled) return;
      const radius = parseFloat(getComputedStyle(btn).borderTopLeftRadius) || 12;
      const target = radius >= 28 ? radius : radius + 10;
      btn.style.setProperty("--press-radius-from", `${radius}px`);
      btn.style.setProperty("--press-radius-to", `${target}px`);

      const rect = btn.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "btn-ripple";
      const localX = e.clientX - rect.left;
      const xRatio = Math.max(0, Math.min(1, localX / Math.max(1, rect.width)));
      const hue = Math.round(224 - xRatio * 126); // left: blue-violet, right: lime-green
      ripple.style.setProperty("--ripple-x", `${localX}px`);
      ripple.style.setProperty("--ripple-y", `${e.clientY - rect.top}px`);
      ripple.style.setProperty("--ripple-h", `${hue}`);
      btn.appendChild(ripple);
      ripple.addEventListener(
        "animationend",
        () => {
          ripple.remove();
        },
        { once: true }
      );

      btn.classList.remove("press-spring");
      // Force reflow to restart animation on rapid repeated taps.
      void btn.offsetWidth;
      btn.classList.add("press-spring");
      btn.addEventListener(
        "animationend",
        () => {
          btn.classList.remove("press-spring");
        },
        { once: true }
      );
    },
    { passive: true }
  );
}

function checkReminderTick() {
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const keyDate = todayStr();

  state.reminders.forEach((r) => {
    if (!r.enabled || r.time !== hhmm) return;
    const key = `${r.id}_${keyDate}`;
    if (state.reminderHits[key]) return;
    state.reminderHits[key] = true;

    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Медитация", { body: r.label });
    } else {
      alert(r.label);
    }
  });

  save();
}

function renderReminders() {
  const root = document.getElementById("reminder-list");
  root.innerHTML = "";

  if (!state.reminders.length) {
    root.innerHTML = `<div class="item"><small>Напоминаний пока нет.</small></div>`;
    return;
  }

  state.reminders
    .slice()
    .sort((a, b) => a.time.localeCompare(b.time))
    .forEach((r) => {
      const div = document.createElement("div");
      div.className = "item swipe-item";
      div.innerHTML = `
        <div class="swipe-action">
          <button type="button" class="swipe-delete-btn" aria-label="Удалить напоминание">
            <span class="trash-icon" aria-hidden="true"></span>
          </button>
        </div>
        <div class="swipe-content">
          <div class="top">
            <strong>${r.time}</strong>
            <div class="inline">
              <label class="inline"><input type="checkbox" ${r.enabled ? "checked" : ""}/>вкл</label>
            </div>
          </div>
          <small>${escapeHtml(r.label)}</small>
        </div>
      `;

      const checkbox = div.querySelector("input");
      checkbox.onchange = () => {
        r.enabled = checkbox.checked;
        save();
        renderReminders();
      };
      bindSwipeDeleteCard(div, {
        onDelete: () => {
          state.reminders = state.reminders.filter((x) => x.id !== r.id);
          save();
          renderReminders();
        },
      });

      root.appendChild(div);
    });
}

function clearServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
}

function renderAll() {
  renderStats();
  renderTodaySessions();
  renderArchive();
  renderSessionDetails();
  renderReminders();
}

function init() {
  load();
  renderNav();
  applyArchiveMode();
  const active = document.querySelector(".screen.active");
  if (active?.id === "screen-home" || active?.id === "screen-timer" || active?.id === "screen-archive") {
    const app = document.querySelector(".app");
    if (app) {
      app.classList.toggle("home-screen", active.id === "screen-home");
      app.classList.toggle("home-flow-bg", active.id === "screen-home");
      app.classList.toggle("timer-flow-bg", active.id === "screen-timer" || active.id === "screen-archive");
    }
  }
  bindButtonSpring();
  bindTimer();
  bindMeditationNotes();
  bindReminders();
  bindAboutModal();
  renderAll();
  clearServiceWorkers();
  positionNavIndicator();
  window.addEventListener("resize", () => positionNavIndicator());
}

init();
