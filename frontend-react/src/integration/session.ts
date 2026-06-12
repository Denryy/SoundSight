// Контроллер сессии SoundSight — жизненный цикл записи (ТЗ §5, §6.3–6.5).
//
// Связывает воедино фиксированный слой интеграции:
//   POST /session/start → WebSocket /ws/subtitles → AudioWorklet (0.5с) → бинарные кадры.
//   Входящие сообщения сервера разбираются и эмитятся как события для UI.
//
// UI не знает деталей протокола — только подписывается на события этого контроллера.

import { api } from "./api";
import { buildAudioFrame, subtitlesWsUrl } from "./audioFrame";
import type {
  ServerMessage,
  SubtitleFinalMessage,
  SubtitleInterimMessage,
} from "./types";

export type SessionPhase =
  | "idle"
  | "connecting"
  | "recording"
  | "stopping"
  | "error";

export interface SessionEvents {
  /** Промежуточная (живая) строка — обновляет последнюю строку, не добавляет новую. */
  interim: (msg: SubtitleInterimMessage) => void;
  /** Финальная фраза — фиксирует строку, keywords и жест аватара. */
  final: (msg: SubtitleFinalMessage) => void;
  /** Смена фазы записи. */
  phase: (phase: SessionPhase, statusText: string) => void;
  /** Человекочитаемая ошибка для показа пользователю. */
  error: (message: string) => void;
  /** Сессия успешно остановлена — отдаём session_id для запроса резюме. */
  stopped: (sessionId: string | null) => void;
}

type Listener<E extends keyof SessionEvents> = SessionEvents[E];

export class SessionController {
  private ws: WebSocket | null = null;
  private wsReady = false;
  private audioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private active = false;
  private listeners: { [K in keyof SessionEvents]: Set<SessionEvents[K]> } = {
    interim: new Set(),
    final: new Set(),
    phase: new Set(),
    error: new Set(),
    stopped: new Set(),
  };

  on<E extends keyof SessionEvents>(event: E, fn: Listener<E>): () => void {
    this.listeners[event].add(fn);
    return () => this.listeners[event].delete(fn);
  }

  private emit<E extends keyof SessionEvents>(
    event: E,
    ...args: Parameters<SessionEvents[E]>
  ): void {
    (this.listeners[event] as Set<(...a: unknown[]) => void>).forEach((fn) =>
      fn(...(args as unknown[])),
    );
  }

  isActive(): boolean {
    return this.active;
  }

  /** Старт сессии: микрофон → POST /session/start → WS → захват аудио. */
  async start(deviceId?: string): Promise<void> {
    if (this.active) return;

    // 1. Микрофон (ТЗ §7: нет доступа → понятное сообщение, не падать).
    try {
      const audio: MediaTrackConstraints | boolean = deviceId
        ? { deviceId: { exact: deviceId } }
        : true;
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio,
        video: false,
      });
    } catch (e) {
      this.emit("error", `Нет доступа к микрофону: ${(e as Error).message}`);
      this.emit("phase", "error", "Нет доступа к микрофону");
      return;
    }

    // 2. Старт сессии на бэкенде.
    this.emit("phase", "connecting", "Подключение…");
    try {
      await api.startSession();
    } catch (e) {
      this.cleanupAudio();
      this.emit("error", `Сервер недоступен: ${(e as Error).message}`);
      this.emit("phase", "error", "Сервер недоступен");
      return;
    }

    this.active = true;

    // 3. WebSocket.
    this.emit("phase", "connecting", "Открытие канала…");
    try {
      await this.openWs();
    } catch {
      this.active = false;
      this.cleanupAudio();
      this.emit("error", "Не удалось открыть WebSocket-канал.");
      this.emit("phase", "error", "Соединение не открылось");
      return;
    }

    // 4. Захват аудио.
    try {
      await this.startCapture();
    } catch (e) {
      await this.stop();
      this.emit("error", `Ошибка захвата аудио: ${(e as Error).message}`);
      this.emit("phase", "error", "Ошибка захвата аудио");
      return;
    }

    this.emit("phase", "recording", "Запись");
  }

  /** Стоп сессии: закрыть WS, POST /session/stop, отдать session_id для резюме. */
  async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    this.emit("phase", "stopping", "Генерация резюме…");

    this.cleanupAudio();
    if (this.ws) {
      this.ws.onclose = null; // не трактовать как обрыв — это штатная остановка
      this.ws.close();
      this.ws = null;
    }
    this.wsReady = false;

    let sessionId: string | null = null;
    try {
      const data = await api.stopSession();
      sessionId = data.session_id ?? null;
    } catch {
      /* стоп не критичен для UI */
    }
    this.emit("phase", "idle", "");
    this.emit("stopped", sessionId);
  }

  private openWs(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(subtitlesWsUrl());
      ws.binaryType = "arraybuffer";
      this.ws = ws;

      ws.onopen = () => {
        this.wsReady = true;
        resolve();
      };
      ws.onmessage = ({ data }) => this.handleMessage(data);
      ws.onerror = (e) => {
        console.error("[WS] error", e);
        reject(e);
      };
      ws.onclose = (e) => {
        this.wsReady = false;
        console.log("[WS] closed", e.code);
        // Обрыв во время записи (ТЗ §7).
        if (this.active) {
          this.active = false;
          this.cleanupAudio();
          this.emit("phase", "error", "Соединение прервано");
          this.emit("error", "Соединение прервано.");
        }
      };
    });
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") return; // сервер шлёт текстовый JSON (§6.4)
    let msg: ServerMessage;
    try {
      msg = JSON.parse(data) as ServerMessage;
    } catch {
      return;
    }
    if (msg.type === "subtitle_interim") this.emit("interim", msg);
    else if (msg.type === "subtitle") this.emit("final", msg);
  }

  private async startCapture(): Promise<void> {
    if (!this.mediaStream) throw new Error("нет медиапотока");

    // ТЗ §6.5: просим 16кГц, но используем реальную частоту из заголовка фрейма.
    this.audioCtx = new AudioContext({ sampleRate: 16000 });
    if (this.audioCtx.state === "suspended") await this.audioCtx.resume();

    await this.audioCtx.audioWorklet.addModule("/recorder-worklet.js");

    const source = this.audioCtx.createMediaStreamSource(this.mediaStream);
    this.workletNode = new AudioWorkletNode(this.audioCtx, "recorder-processor");

    this.workletNode.port.onmessage = ({ data: msg }) => {
      if (msg.type === "chunk" && this.wsReady && this.ws?.readyState === WebSocket.OPEN) {
        const frame = buildAudioFrame(msg.buffer as ArrayBuffer, msg.sampleRate as number);
        this.ws.send(frame);
      }
    };

    source.connect(this.workletNode);
  }

  private cleanupAudio(): void {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
  }
}

export const session = new SessionController();
