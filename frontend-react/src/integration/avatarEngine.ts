// Шина движков жестового аватара: собственный 3D (native) ↔ внешний CWASA.
//
// UI и SessionContext работают ТОЛЬКО через эту шину: она роутит payload
// финальных субтитров в активный движок, отдаёт готовность текущего движка
// и хранит выбор пользователя в localStorage.

import { cwasa } from "./cwasa";
import { nativeAvatar } from "../avatar3d/player";
import type { NativeLexicon } from "../avatar3d/poseTypes";
import type { SubtitleFinalMessage } from "./types";

export type AvatarEngineKind = "native" | "cwasa";

const ENGINE_KEY = "soundsight.avatarEngine";

function readEngine(): AvatarEngineKind {
  const v = localStorage.getItem(ENGINE_KEY);
  return v === "cwasa" ? "cwasa" : "native"; // дефолт — собственный аватар
}

let engine: AvatarEngineKind = readEngine();
const engineListeners = new Set<(kind: AvatarEngineKind) => void>();

// Готовность: отражаем состояние ТЕКУЩЕГО движка; при переключении ре-эмитим.
const readyListeners = new Set<(ready: boolean) => void>();
let lastReady: boolean | null = null;

function emitReady(): void {
  const ready = engine === "native" ? nativeAvatar.isReady() : cwasa.isReady();
  if (ready === lastReady) return;
  lastReady = ready;
  readyListeners.forEach((fn) => fn(ready));
}

nativeAvatar.onReadyChange(() => {
  if (engine === "native") emitReady();
});
cwasa.onReadyChange(() => {
  if (engine === "cwasa") emitReady();
});

// Лексикон глоссов подтягивается с бэкенда один раз (единый источник правды).
// Если бэкенд недоступен — дактиль всё равно работает (алфавиты в бандле),
// а глоссы плеер просто пропустит с предупреждением.
let lexiconLoaded = false;

async function ensureLexicon(): Promise<void> {
  if (lexiconLoaded) return;
  lexiconLoaded = true;
  try {
    const res = await fetch("/avatar/native/lexicon");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const lex = (await res.json()) as NativeLexicon;
    nativeAvatar.setLexicon(lex);
  } catch (e) {
    lexiconLoaded = false; // позволить повторить позже
    console.warn("[avatarEngine] лексикон не загружен:", (e as Error).message);
  }
}

export const avatarEngine = {
  getEngine(): AvatarEngineKind {
    return engine;
  },

  setEngine(kind: AvatarEngineKind): void {
    if (kind === engine) return;
    engine = kind;
    localStorage.setItem(ENGINE_KEY, kind);
    // Уходящий движок останавливаем, чтобы не доигрывал в фоне.
    if (kind === "native") {
      cwasa.clearQueue();
    } else {
      nativeAvatar.stopAll();
    }
    engineListeners.forEach((fn) => fn(kind));
    lastReady = null;
    emitReady();
  },

  onEngineChange(fn: (kind: AvatarEngineKind) => void): () => void {
    engineListeners.add(fn);
    fn(engine);
    return () => engineListeners.delete(fn);
  },

  /** Роутинг финального субтитра в активный движок. */
  playFinal(msg: SubtitleFinalMessage): void {
    if (engine === "native") {
      nativeAvatar.play(msg.avatar_pose ?? null);
    } else {
      cwasa.play(msg.avatar_sigml);
    }
  },

  /** Готовность ТЕКУЩЕГО движка (для бейджа в UI). */
  onReadyChange(fn: (ready: boolean) => void): () => void {
    readyListeners.add(fn);
    fn(engine === "native" ? nativeAvatar.isReady() : cwasa.isReady());
    return () => readyListeners.delete(fn);
  },

  /** Очистить очереди обоих движков (старт новой сессии). */
  clearQueues(): void {
    nativeAvatar.clearQueue();
    cwasa.clearQueue();
  },

  /** Инициализация native-движка: подгрузка лексикона глоссов. */
  ensureLexicon,
};
