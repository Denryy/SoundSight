// Глобальное состояние сессии для UI. Оборачивает фиксированный слой интеграции
// (SessionController + CwasaController) и отдаёт React-friendly состояние и действия.
//
// Производительность (ТЗ §9): interim-строка хранится отдельным состоянием,
// поэтому частые subtitle_interim не перерисовывают список финальных строк.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { api } from "../integration/api";
import { avatarEngine } from "../integration/avatarEngine";
import { session, type SessionPhase } from "../integration/session";
import type { LangMode } from "../integration/types";

export interface FinalLine {
  id: number;
  text: string;
  keywords: string[];
}

interface SessionState {
  phase: SessionPhase;
  statusText: string;
  active: boolean;
  error: string | null;

  interim: string;
  finals: FinalLine[];
  keywords: string[];

  avatarReady: boolean;

  // Настройки
  mics: MediaDeviceInfo[];
  selectedMic: string;
  setSelectedMic: (id: string) => void;
  lang: LangMode;
  langSwitching: boolean;
  setLang: (mode: LangMode) => void;
  fontScale: number;
  setFontScale: (scale: number) => void;

  // Резюме
  summary: string | null;

  // Действия
  start: () => Promise<void>;
  stop: () => Promise<void>;
  dismissError: () => void;
}

const Ctx = createContext<SessionState | null>(null);

const FONT_SCALE_KEY = "soundsight.fontScale";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<SessionPhase>("idle");
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [interim, setInterim] = useState("");
  const [finals, setFinals] = useState<FinalLine[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);

  const [avatarReady, setAvatarReady] = useState(false);

  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState("");
  const [lang, setLangState] = useState<LangMode>("auto");
  const [langSwitching, setLangSwitching] = useState(false);
  const [fontScale, setFontScaleState] = useState<number>(() => {
    const saved = Number(localStorage.getItem(FONT_SCALE_KEY));
    return saved >= 0.8 && saved <= 2 ? saved : 1;
  });

  const [summary, setSummary] = useState<string | null>(null);

  const finalIdRef = useRef(0);

  const active = phase === "recording" || phase === "connecting";

  // ── Подписка на события сессии ──────────────────────────────────────────
  useEffect(() => {
    const offs = [
      session.on("interim", (msg) => setInterim(msg.text)),
      session.on("final", (msg) => {
        // Зафиксировать interim как финальную строку (ТЗ §6.4).
        setFinals((prev) => [
          ...prev,
          { id: ++finalIdRef.current, text: msg.text, keywords: msg.keywords ?? [] },
        ]);
        setInterim("");
        if (msg.keywords?.length) setKeywords(msg.keywords);
        avatarEngine.playFinal(msg);
      }),
      session.on("phase", (p, text) => {
        setPhase(p);
        setStatusText(text);
      }),
      session.on("error", (message) => setError(message)),
      session.on("stopped", async (sessionId) => {
        if (!sessionId) return;
        try {
          const data = await api.getSummary(sessionId);
          if (data.summary) setSummary(data.summary);
        } catch {
          /* резюме может быть недоступно */
        }
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  // ── Готовность аватара ──────────────────────────────────────────────────
  // Инициализация движков — в AvatarPanel (когда контейнеры уже в DOM); здесь
  // только подписка на готовность ТЕКУЩЕГО движка для индикатора в UI.
  useEffect(() => avatarEngine.onReadyChange(setAvatarReady), []);

  // ── Список микрофонов (ТЗ §4.5) ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const audioIns = devices.filter((d) => d.kind === "audioinput");
        setMics(audioIns);
        setSelectedMic((prev) =>
          prev && audioIns.some((d) => d.deviceId === prev)
            ? prev
            : (audioIns[0]?.deviceId ?? ""),
        );
      } catch {
        /* enumerate может упасть без разрешения */
      }
    };
    // Запросить разрешение разово, чтобы получить лейблы устройств.
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => s.getTracks().forEach((t) => t.stop()))
      .catch(() => {})
      .finally(refresh);

    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", refresh);
    };
  }, []);

  // ── Синхронизация языка с сервером при загрузке ─────────────────────────
  useEffect(() => {
    api
      .getMode()
      .then((d) => setLangState(d.mode))
      .catch(() => {});
  }, []);

  // ── Размер шрифта субтитров (ТЗ §8) ─────────────────────────────────────
  useEffect(() => {
    document.documentElement.style.setProperty("--subtitle-scale", String(fontScale));
    localStorage.setItem(FONT_SCALE_KEY, String(fontScale));
  }, [fontScale]);

  const setLang = useCallback(
    async (mode: LangMode) => {
      if (langSwitching || mode === lang) return;
      setLangSwitching(true);
      const isKZ = mode === "kz";
      setStatusText(isKZ ? "Загрузка KZ-модели (~10 сек)…" : "Смена языка…");
      try {
        await api.setMode(mode);
        setLangState(mode);
      } catch {
        setError("Не удалось сменить язык.");
      } finally {
        setLangSwitching(false);
        setStatusText(session.isActive() ? "Запись" : "");
      }
    },
    [lang, langSwitching],
  );

  const start = useCallback(async () => {
    setError(null);
    setSummary(null);
    setFinals([]);
    setInterim("");
    setKeywords([]);
    avatarEngine.clearQueues();
    await session.start(selectedMic || undefined);
  }, [selectedMic]);

  const stop = useCallback(async () => {
    await session.stop();
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      phase,
      statusText,
      active,
      error,
      interim,
      finals,
      keywords,
      avatarReady,
      mics,
      selectedMic,
      setSelectedMic,
      lang,
      langSwitching,
      setLang,
      fontScale,
      setFontScale: setFontScaleState,
      summary,
      start,
      stop,
      dismissError: () => setError(null),
    }),
    [
      phase,
      statusText,
      active,
      error,
      interim,
      finals,
      keywords,
      avatarReady,
      mics,
      selectedMic,
      lang,
      langSwitching,
      setLang,
      fontScale,
      summary,
      start,
      stop,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSession(): SessionState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
