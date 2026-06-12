const API    = "";
const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/subtitles`;

// ── DOM refs ──────────────────────────────────────────────────────────────
const btnStart     = document.getElementById("btnStart");
const btnStop      = document.getElementById("btnStop");
const statusDot    = document.getElementById("statusDot");
const statusMsg    = document.getElementById("statusMsg");
const subtitleBox  = document.getElementById("subtitleBox");
const subtitleEmpty = document.getElementById("subtitleEmpty");
const keywordsEl   = document.getElementById("keywords");
const avatarLabel  = document.getElementById("avatarLabel");
const avatarLiveBadge = document.getElementById("avatarLiveBadge");
const summaryPanel = document.getElementById("summaryPanel");
const summaryEmpty = document.getElementById("summaryEmpty");
const summaryTextBlock = document.getElementById("summaryTextBlock");
const summaryText  = document.getElementById("summaryText");
const summaryLiveText = document.getElementById("summaryLiveText");
const micSelect    = document.getElementById("micSelect");
const langBtns     = document.querySelectorAll(".lang-btn");

// ── State ─────────────────────────────────────────────────────────────────
let ws           = null;
let wsReady      = false;
let audioCtx     = null;
let mediaStream  = null;
let workletNode  = null;
let sessionActive  = false;
let langSwitching  = false;
let liveUpdateTimer = null;

// History session tracking (for saving finished sessions to localStorage)
let sessionStartMs = 0;
let sessionPhraseCount = 0;
const sessionKeywordCounts = new Map();

// ══════════════════════════════════════════════════════════════════════════
// SCREEN ROUTER
// ══════════════════════════════════════════════════════════════════════════

const screens = {
  home:      document.getElementById("screenHome"),
  subtitles: document.getElementById("screenSubtitles"),
  summary:   document.getElementById("screenSummary"),
  history:   document.getElementById("screenHistory"),
};

const navLinks = document.querySelectorAll(".nav-link");

function navigateTo(name) {
  Object.entries(screens).forEach(([k, el]) => {
    el.classList.toggle("active", k === name);
  });
  navLinks.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.screen === name);
  });

  if (name === "summary") startLiveUpdate();
  else stopLiveUpdate();

  if (name === "history") renderHistory();
}

navLinks.forEach(btn => {
  btn.addEventListener("click", () => navigateTo(btn.dataset.screen));
});

// ── Hero Start button (Home screen) ─────────────────────────────────────
function startHeroSession() {
  navigateTo("subtitles");
  // small delay to let render settle before starting audio
  setTimeout(startSession, 100);
}

// ══════════════════════════════════════════════════════════════════════════
// SETTINGS PANEL
// ══════════════════════════════════════════════════════════════════════════

function openSettings() {
  document.getElementById("settingsOverlay").classList.remove("hidden");
  document.getElementById("settingsPanel").classList.remove("hidden");
}

function closeSettings() {
  document.getElementById("settingsOverlay").classList.add("hidden");
  document.getElementById("settingsPanel").classList.add("hidden");
}

// ══════════════════════════════════════════════════════════════════════════
// HISTORY MODAL
// ══════════════════════════════════════════════════════════════════════════

// Seed examples shown only when no real sessions are stored yet.
const MOCK_SESSIONS = [
  {
    title: "Лекция по машинному обучению",
    date: "14 апреля 2026 · 09:15", lang: "RU", duration: "42 мин", minutes: 42,
    phrases: 247, keywords: ["нейросети", "градиент", "классификация"],
    preview: "Обсуждались основы нейронных сетей, методы обратного распространения ошибки и практическое применение градиентного спуска в задачах классификации изображений…",
    summary: "Ключевые темы: нейросети, градиентный спуск, классификация.\n\nРассматривались основы нейронных сетей и методы обратного распространения ошибки. Подробно объяснён принцип градиентного спуска и его роль в обучении моделей. Приведены практические примеры классификации изображений с использованием свёрточных сетей.",
  },
  {
    title: "Публичная лекция — Доступность технологий",
    date: "13 апреля 2026 · 14:00", lang: "KZ", duration: "28 мин", minutes: 28,
    phrases: 158, keywords: ["доступность", "инклюзия", "дизайн"],
    preview: "Рассматривались принципы универсального дизайна, международный опыт создания инклюзивных цифровых продуктов и роль AI в обеспечении доступности для людей с ОВЗ…",
    summary: "Ключевые темы: доступность, инклюзия, универсальный дизайн.\n\nРассмотрены принципы универсального дизайна и международный опыт создания инклюзивных цифровых продуктов. Подчёркнута роль AI-технологий в обеспечении доступности для людей с ограниченными возможностями здоровья.",
  },
];

// ── Persistent history store (localStorage) ─────────────────────────────────
const HISTORY_KEY = "soundsight.history.v1";
let historyView = [];   // entries currently rendered (real sessions, or mock seed)

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch (_) { return []; }
}
function persistHistory(list) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 50))); }
  catch (_) {}
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const _ICON_MSG  = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
const _ICON_CAL  = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
const _ICON_MSGS = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
const _ICON_AVA  = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>';

function historyCardHTML(s, idx) {
  const accent = idx % 2 === 0 ? "indigo" : "emerald";
  const lang = String(s.lang || "RU").toUpperCase();
  const kws = (s.keywords || []).slice(0, 3)
    .map(k => `<span class="kw-tag">${esc(k)}</span>`).join("");
  const dur = s.duration ? `<span class="badge badge-dur">${esc(s.duration)}</span>` : "";
  return `
    <article class="history-card" data-accent="${accent}" onclick="openHistoryCard(${idx})">
      <div class="history-card-accent"></div>
      <div class="history-card-body">
        <div class="history-card-header">
          <div class="history-card-icon">${_ICON_MSG}</div>
          <div class="history-card-meta">
            <span class="history-card-title">${esc(s.title)}</span>
            <span class="history-card-date">${_ICON_CAL} ${esc(s.date || "")}</span>
          </div>
          <div class="history-card-badges">
            <span class="badge badge-${esc(lang.toLowerCase())}">${esc(lang)}</span>
            ${dur}
          </div>
        </div>
        <p class="history-card-preview">${esc(s.preview || s.summary || "")}</p>
        <div class="history-card-footer">
          <div class="history-stats-row">
            <div class="history-stat">${_ICON_MSGS}<span>${Number(s.phrases || 0)} фраз</span></div>
            <div class="history-stat">${_ICON_AVA}<span>Аватар</span></div>
          </div>
          <div class="history-stat-keywords">${kws}</div>
        </div>
      </div>
    </article>`;
}

function renderHistory() {
  const real = loadHistory();
  historyView = real.length ? real : MOCK_SESSIONS;
  const list = document.getElementById("historyList");
  if (list) list.innerHTML = historyView.map(historyCardHTML).join("");

  // Update header stat chips from real data (sessions / minutes / phrases).
  const chips = document.querySelectorAll(".history-stat-chip .stat-chip-num");
  if (chips.length >= 3 && real.length) {
    chips[0].textContent = real.length;
    chips[1].textContent = real.reduce((a, s) => a + (Number(s.minutes) || 0), 0);
    chips[2].textContent = real.reduce((a, s) => a + (Number(s.phrases) || 0), 0);
  }
}

function openHistoryCard(idx) {
  const s = historyView[idx];
  if (!s) return;
  document.getElementById("historyModalTitle").textContent = s.title;
  document.getElementById("historyModalSummary").textContent = s.summary || "";
  document.getElementById("historyModalOverlay").classList.remove("hidden");
  document.getElementById("historyModal").classList.remove("hidden");
}

function closeHistoryModal() {
  document.getElementById("historyModalOverlay").classList.add("hidden");
  document.getElementById("historyModal").classList.add("hidden");
}

// Persist a finished session into history and re-render the list.
function saveSessionToHistory(summaryData) {
  const summary = summaryData.summary || "";
  if (!summary) return;

  const now = new Date();
  const minutes = sessionStartMs
    ? Math.max(1, Math.round((Date.now() - sessionStartMs) / 60000)) : 0;
  const topKw = [...sessionKeywordCounts.entries()]
    .sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 3);
  const activeLang = document.querySelector(".lang-btn.active")?.dataset.mode || "ru";

  const entry = {
    id: summaryData.session_id || String(Date.now()),
    title: topKw.length ? `Сессия · ${topKw.join(", ")}`
                        : `Сессия · ${now.toLocaleDateString("ru-RU")}`,
    date: now.toLocaleString("ru-RU",
      { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    lang: activeLang.toUpperCase(),
    duration: minutes ? `${minutes} мин` : "",
    minutes,
    phrases: sessionPhraseCount,
    keywords: topKw,
    preview: (summaryData.transcript_preview || summary).slice(0, 220),
    summary,
    savedAt: Date.now(),
  };

  const list = loadHistory().filter(e => e.id !== entry.id); // de-dup by session id
  list.unshift(entry);
  persistHistory(list);
  renderHistory();
}

// ══════════════════════════════════════════════════════════════════════════
// CWASA AVATAR
// ══════════════════════════════════════════════════════════════════════════

let cwasaReady = false;
let avatarBusy = false;
const sigmlQueue = [];

function _drainQueue() {
  if (avatarBusy || sigmlQueue.length === 0) return;
  const sigml = sigmlQueue.shift();
  avatarBusy = true;
  console.log(`[CWASA] playSiGMLText (${sigml.length} chars):`, sigml.slice(0, 80));
  try {
    CWASA.playSiGMLText(sigml);
  } catch (e) {
    console.warn("[CWASA] playSiGMLText failed:", e.message);
    avatarBusy = false;
    _drainQueue();
  }
}

if (typeof CWASA !== "undefined") {
  CWASA.addHook("avatarready", () => {
    cwasaReady = true;
    console.log("[CWASA] avatarready → ready to sign");
    _drainQueue();
  });
  CWASA.addHook("avatarloaded", () => {
    cwasaReady = true;
    console.log("[CWASA] avatarloaded");
    _drainQueue();
  });
  CWASA.addHook("animidle", () => {
    avatarBusy = false;
    console.log("[CWASA] animidle");
    _drainQueue();
  });
  // Diagnostics: surface the SiGML→animation lifecycle in the console.
  CWASA.addHook("sigmlloading", () => console.log("[CWASA] sigmlloading…"));
  CWASA.addHook("sigmlloaded", () => console.log("[CWASA] sigmlloaded (signs converted)"));
  CWASA.addHook("animactive", () => console.log("[CWASA] animactive (playing)"));
}

function playSign(sigml) {
  if (!sigml || !cwasaReady) {
    if (sigml) { sigmlQueue.push(sigml); if (sigmlQueue.length > 5) sigmlQueue.shift(); }
    return;
  }
  sigmlQueue.push(sigml);
  if (sigmlQueue.length > 5) sigmlQueue.shift();
  _drainQueue();
}

// ══════════════════════════════════════════════════════════════════════════
// MICROPHONE LIST
// ══════════════════════════════════════════════════════════════════════════

async function initMicList() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach(t => t.stop());
  } catch (_) {}
  await fillMicSelect();
}

async function fillMicSelect() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter(d => d.kind === "audioinput");
    const prev = micSelect.value;
    micSelect.innerHTML = "";
    mics.forEach((d, i) => {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || `Микрофон ${i + 1}`;
      micSelect.appendChild(opt);
    });
    if (prev && [...micSelect.options].some(o => o.value === prev)) micSelect.value = prev;
  } catch (e) {
    console.warn("[Mic] enumerate failed:", e.message);
  }
}

navigator.mediaDevices.addEventListener("devicechange", fillMicSelect);

// ══════════════════════════════════════════════════════════════════════════
// SESSION
// ══════════════════════════════════════════════════════════════════════════

async function startSession() {
  if (sessionActive) return;

  const deviceId = micSelect.value;
  try {
    const constraints = deviceId ? { deviceId: { exact: deviceId } } : true;
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
    console.log("[Mic] using:", micSelect.options[micSelect.selectedIndex]?.textContent);
  } catch (e) {
    alert("Нет доступа к микрофону: " + e.message);
    return;
  }

  setStatus("Подключение...");
  try {
    const res = await fetch(`${API}/session/start`, { method: "POST" });
    if (!res.ok) {
      alert("Ошибка сервера: " + res.status);
      stopCapture();
      return;
    }
    await res.json();
  } catch (e) {
    alert("Сервер недоступен: " + e.message);
    stopCapture();
    return;
  }

  sessionActive = true;
  // Reset per-session history trackers
  sessionStartMs = Date.now();
  sessionPhraseCount = 0;
  sessionKeywordCounts.clear();
  setActive(true);
  setStatus("Открытие канала...");

  // Clear previous subtitles
  subtitleBox.innerHTML = "";
  subtitleEmpty.classList.add("hidden");

  try {
    await openWSAndWait();
  } catch (e) {
    sessionActive = false;
    setActive(false);
    stopCapture();
    return;
  }

  setStatus("Запись");
  await startCapture();
}

async function stopSession() {
  if (!sessionActive) return;

  sessionActive = false;
  stopCapture();
  if (ws) { ws.close(); ws = null; }
  wsReady = false;
  setActive(false);
  setStatus("Генерация резюме...");

  try {
    const res = await fetch(`${API}/session/stop`, { method: "POST" });
    const data = await res.json();
    if (data.session_id) await fetchSummary(data.session_id);
  } catch (_) {}
  setStatus("");
}

// ══════════════════════════════════════════════════════════════════════════
// WEBSOCKET
// ══════════════════════════════════════════════════════════════════════════

function openWSAndWait() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => { wsReady = true; resolve(); };
    ws.onmessage = ({ data }) => {
      try {
        const p = JSON.parse(data);
        if (p.type === "subtitle") appendSubtitle(p);
        else if (p.type === "subtitle_interim") updateInterim(p);
      } catch (_) {}
    };
    ws.onerror = (e) => { console.error("[WS] error", e); reject(e); };
    ws.onclose = (e) => {
      wsReady = false;
      console.log("[WS] closed", e.code);
      if (sessionActive) {
        sessionActive = false;
        stopCapture();
        setActive(false);
        setStatus("Соединение прервано");
        setTimeout(() => setStatus(""), 3000);
      }
    };
  });
}

// ══════════════════════════════════════════════════════════════════════════
// AUDIO CAPTURE
// ══════════════════════════════════════════════════════════════════════════

async function startCapture() {
  audioCtx = new AudioContext({ sampleRate: 16000 });
  if (audioCtx.state === "suspended") await audioCtx.resume();

  await audioCtx.audioWorklet.addModule("/static/recorder-worklet.js");

  const source = audioCtx.createMediaStreamSource(mediaStream);
  workletNode  = new AudioWorkletNode(audioCtx, "recorder-processor");

  let n = 0;
  workletNode.port.onmessage = ({ data: msg }) => {
    if (msg.type === "init") { console.log("[Audio] worklet rate:", msg.sampleRate); return; }
    if (msg.type === "chunk" && wsReady && ws?.readyState === WebSocket.OPEN) {
      n++;
      const header = new ArrayBuffer(8);
      const v = new DataView(header);
      v.setUint32(0, 0x53535400, false); // "SST\0" (SoundSighT)
      v.setUint32(4, msg.sampleRate, true);
      const frame = new Uint8Array(8 + msg.buffer.byteLength);
      frame.set(new Uint8Array(header), 0);
      frame.set(new Uint8Array(msg.buffer), 8);
      ws.send(frame.buffer);
      if (n % 5 === 1) console.log(`[Audio] chunk #${n} ${msg.buffer.byteLength}B`);
    }
  };

  source.connect(workletNode);
}

function stopCapture() {
  if (workletNode)  { workletNode.disconnect(); workletNode = null; }
  if (audioCtx)     { audioCtx.close(); audioCtx = null; }
  if (mediaStream)  { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
}

// ══════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ══════════════════════════════════════════════════════════════════════════

function setActive(active) {
  btnStart.disabled  = active;
  btnStop.disabled   = !active;
  micSelect.disabled = active;
  statusDot.className = active ? "dot dot-active" : "dot dot-idle";
  if (avatarLiveBadge) {
    avatarLiveBadge.classList.toggle("recording", active);
    const label = avatarLiveBadge.querySelector(".live-label");
    if (label) label.textContent = active ? "Идёт запись" : "Сессия не активна";
  }
  if (!active) setStatus("");
  _updateLangBtns();
}

function _updateLangBtns() {
  langBtns.forEach(b => { b.disabled = langSwitching; });
}

function setStatus(msg) {
  statusMsg.textContent = msg;
}

// Live (in-progress) caption — a single line updated as the user speaks.
let interimDiv = null;

function updateInterim({ text }) {
  if (!text) return;
  if (subtitleEmpty) subtitleEmpty.classList.add("hidden");
  if (!interimDiv) {
    interimDiv = document.createElement("div");
    interimDiv.className = "subtitle-chunk subtitle-interim";
    interimDiv.style.opacity = "0.55";
    subtitleBox.appendChild(interimDiv);
  }
  interimDiv.textContent = text;
  subtitleBox.scrollTop = subtitleBox.scrollHeight;
}

function appendSubtitle({ text, keywords, avatar_sigml }) {
  // remove empty state placeholder
  if (subtitleEmpty) subtitleEmpty.classList.add("hidden");

  // promote the live line into a finalised chunk
  if (interimDiv) { interimDiv.remove(); interimDiv = null; }

  const div = document.createElement("div");
  div.className = "subtitle-chunk";
  div.textContent = text;
  subtitleBox.appendChild(div);
  subtitleBox.scrollTop = subtitleBox.scrollHeight;

  // Track this finalised phrase + its keywords for the session history entry.
  sessionPhraseCount++;
  (keywords || []).forEach(k =>
    sessionKeywordCounts.set(k, (sessionKeywordCounts.get(k) || 0) + 1));

  if (keywords?.length) renderKeywords(keywords);
  if (avatar_sigml) {
    avatarLabel.textContent = text.slice(0, 80);
    playSign(avatar_sigml);
  }
}

function renderKeywords(words) {
  keywordsEl.innerHTML = "";
  words.forEach(w => {
    const s = document.createElement("span");
    s.className = "keyword-tag";
    s.textContent = w;
    keywordsEl.appendChild(s);
  });
}

// ── Summary fetch (after session stop) ───────────────────────────────────

async function fetchSummary(sessionId) {
  if (!sessionId) return;
  try {
    const res = await fetch(`${API}/summary/${sessionId}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.summary) return;
    summaryText.textContent = data.summary;
    summaryEmpty.classList.add("hidden");
    summaryTextBlock.classList.remove("hidden");
    // Persist this finished session into history (localStorage).
    saveSessionToHistory(data);
    // navigate to summary screen
    navigateTo("summary");
  } catch (e) {
    console.error("[Summary] fetch failed:", e);
  }
}

// ── Live transcript update on Summary screen ─────────────────────────────

async function updateLiveTranscript() {
  if (!sessionActive) return;
  try {
    const res = await fetch(`${API}/summary/current/live`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.text && summaryLiveText) {
      summaryLiveText.textContent = data.text;
    }
  } catch (_) {}
}

function startLiveUpdate() {
  stopLiveUpdate();
  if (sessionActive) {
    liveUpdateTimer = setInterval(updateLiveTranscript, 3000);
  }
}

function stopLiveUpdate() {
  if (liveUpdateTimer) { clearInterval(liveUpdateTimer); liveUpdateTimer = null; }
}

// ══════════════════════════════════════════════════════════════════════════
// AMBIENT BACKGROUND
// ══════════════════════════════════════════════════════════════════════════

function initAmbientMotion() {
  const root = document.documentElement;
  const bg = document.querySelector(".bg-ambient");
  if (!bg || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  let rafId = 0;
  let targetX = 0;
  let targetY = 0;
  let currentX = 0;
  let currentY = 0;

  const setShiftVars = (x, y) => {
    root.style.setProperty("--bg-shift-x", `${x}px`);
    root.style.setProperty("--bg-shift-y", `${y}px`);
    root.style.setProperty("--bg-shift-x-soft", `${(x * 0.6).toFixed(2)}px`);
    root.style.setProperty("--bg-shift-y-soft", `${(y * 0.6).toFixed(2)}px`);
    root.style.setProperty("--bg-shift-x-invert", `${(-x * 0.72).toFixed(2)}px`);
    root.style.setProperty("--bg-shift-y-invert", `${(-y * 0.72).toFixed(2)}px`);
    root.style.setProperty("--bg-shift-x-tiny", `${(x * 0.22).toFixed(2)}px`);
    root.style.setProperty("--bg-shift-y-tiny", `${(y * 0.22).toFixed(2)}px`);
    root.style.setProperty("--bg-shift-x-tiny-invert", `${(-x * 0.18).toFixed(2)}px`);
    root.style.setProperty("--bg-shift-y-tiny-invert", `${(-y * 0.18).toFixed(2)}px`);
  };

  const tick = () => {
    currentX += (targetX - currentX) * 0.08;
    currentY += (targetY - currentY) * 0.08;
    setShiftVars(currentX, currentY);

    if (Math.abs(targetX - currentX) > 0.02 || Math.abs(targetY - currentY) > 0.02) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = 0;
    }
  };

  const queueTick = () => {
    if (!rafId) rafId = requestAnimationFrame(tick);
  };

  window.addEventListener("pointermove", (event) => {
    const xRatio = event.clientX / window.innerWidth - 0.5;
    const yRatio = event.clientY / window.innerHeight - 0.5;
    targetX = Number((xRatio * 10).toFixed(2));
    targetY = Number((yRatio * 8).toFixed(2));
    queueTick();
  }, { passive: true });

  window.addEventListener("pointerleave", () => {
    targetX = 0;
    targetY = 0;
    queueTick();
  }, { passive: true });
}

// ══════════════════════════════════════════════════════════════════════════
// LANGUAGE SWITCHER
// ══════════════════════════════════════════════════════════════════════════

langBtns.forEach(btn => {
  btn.addEventListener("click", async () => {
    if (langSwitching) return;

    const mode = btn.dataset.mode;
    const isKZ = mode === "kz";
    const prevActive = document.querySelector(".lang-btn.active");

    langSwitching = true;
    _updateLangBtns();
    setStatus(isKZ ? "Загрузка KZ модели (~10 сек)..." : "Смена языка...");

    try {
      const res = await fetch(`${API}/session/mode/${mode}`, { method: "POST" });
      if (res.ok) {
        langBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      } else {
        prevActive?.classList.add("active");
        console.error("[Lang] switch failed:", res.status);
      }
    } catch (e) {
      prevActive?.classList.add("active");
      console.error("[Lang] switch failed:", e);
    } finally {
      langSwitching = false;
      _updateLangBtns();
      setStatus(sessionActive ? "Запись" : "");
    }
  });
});

// Sync lang buttons with server state on load
fetch(`${API}/session/mode`)
  .then(r => r.json())
  .then(d => langBtns.forEach(b => b.classList.toggle("active", b.dataset.mode === d.mode)))
  .catch(() => {});

// ══════════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════════

initAmbientMotion();
initMicList();
renderHistory();

if (typeof CWASA !== "undefined") {
  CWASA.init();
}

// ── Dev helper: test a sign without a live session ──────────────────────────
// Usage in browser console:  previewSign("книга")  /  previewSign("hello")
async function previewSign(text) {
  try {
    const res = await fetch(`${API}/avatar/preview?text=${encodeURIComponent(text)}`);
    const data = await res.json();
    console.log("[previewSign]", text, "→ EN:", data.translated_en,
                "| has_sign:", data.has_sign);
    if (data.has_sign && data.sigml) {
      avatarLabel.textContent = text;
      playSign(data.sigml);
    } else {
      console.warn("[previewSign] no sign available for:", text);
    }
    return data;
  } catch (e) {
    console.error("[previewSign] failed:", e);
  }
}
window.previewSign = previewSign;

// Dev helper: raw fingerspell any text to check handshapes. spell("hello")
async function spell(text) {
  try {
    const res = await fetch(`${API}/avatar/spell?text=${encodeURIComponent(text)}`);
    const data = await res.json();
    console.log("[spell]", text, "→", data.signs, "letters");
    if (data.sigml) { avatarLabel.textContent = text; playSign(data.sigml); }
    return data;
  } catch (e) { console.error("[spell] failed:", e); }
}
window.spell = spell;
