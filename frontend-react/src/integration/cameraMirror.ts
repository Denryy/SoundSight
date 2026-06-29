// Живое зеркало: веб-камера → MediaPipe Tasks (Pose + Hand) → ретаргет → поза.
//
// Используем @mediapipe/tasks-vision — современный ESM-нативный MediaPipe,
// дружелюбный к Vite (в отличие от legacy @mediapipe/holistic с его глобальным
// Module и file-packager'ом, который под бандлером падал на загрузке wasm).
// PoseLandmarker даёт 33 МИРОВЫХ ориентира тела (с visibility), HandLandmarker —
// по 21 точке на кисть + handedness. Индексы совпадают с ml/extract_pose_clip.py,
// поэтому frameToPose() из poseRetarget.ts применяется без изменений.
//
// Ассеты самохостятся из public/mediapipe/ (wasm-fileset + модели .task) — без
// CDN, офлайн. Леворукость монокулярной камеры калибруется тумблером «поменять
// руки» (handedness размечается от лица субъекта; для селфи иногда инвертна).

import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
  type HandLandmarkerResult,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";

import { frameToPose, type HandsMode, type Vec3 } from "../avatar3d/poseRetarget";
import { solveHandWorld } from "../avatar3d/handOrient";
import type { HandWorld, Pose } from "../avatar3d/poseTypes";

const WASM_PATH = "/mediapipe/tasks/wasm";
const POSE_MODEL = "/mediapipe/models/pose_landmarker_full.task";
const HAND_MODEL = "/mediapipe/models/hand_landmarker.task";
const WATCHDOG_MS = 12000; // нет ни одного результата за это время → сообщаем

// Граф кисти MediaPipe: связи между 21 ориентиром (фаланги пальцев + ладонь).
const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],         // большой
  [0, 5], [5, 6], [6, 7], [7, 8],         // указательный
  [5, 9], [9, 10], [10, 11], [11, 12],    // средний
  [9, 13], [13, 14], [14, 15], [15, 16],  // безымянный
  [13, 17], [17, 18], [18, 19], [19, 20], // мизинец
  [0, 17],                                 // основание ладони
];
// Руки скелета позы (плечо→локоть→запястье + линия плеч) — контекст для кистей.
const POSE_ARM_CONNECTIONS: [number, number][] = [
  [11, 13], [13, 15], [12, 14], [14, 16], [11, 12],
];
type LM = { x: number; y: number };

// CWASA (allcsa.js) при инициализации своего WASM затирает
// WebAssembly.instantiateStreaming. Из-за этого Emscripten-загрузка tasks-vision
// уходит в кривой ArrayBuffer-фолбэк, модуль грузится неполноценно и
// createFromOptions падает «reading value». Снимаем оригинал на eval нашего
// модуля (это до асинхронной загрузки allcsa.js) и восстанавливаем перед стартом.
const _origStreaming: typeof WebAssembly.instantiateStreaming | undefined =
  typeof WebAssembly !== "undefined" && typeof WebAssembly.instantiateStreaming === "function"
    ? WebAssembly.instantiateStreaming.bind(WebAssembly)
    : undefined;

function restoreWasmStreaming(): void {
  const w = window as unknown as { __origWasmStreaming?: typeof WebAssembly.instantiateStreaming };
  const orig = w.__origWasmStreaming ?? _origStreaming; // снимок из main.tsx — самый ранний
  // Восстанавливаем, если текущая функция — НЕ наш оригинал. CWASA может не
  // удалить instantiateStreaming, а подменить её сломанной функцией; проверки
  // «это вообще функция?» тут мало — сравниваем именно со снимком.
  if (orig && WebAssembly.instantiateStreaming !== orig) {
    try {
      WebAssembly.instantiateStreaming = orig;
    } catch {
      /* свойство неконфигурируемо — игнорируем */
    }
  }
}

export interface CameraMirrorOptions {
  /** Куда отдавать ретаргетнутую позу (null — кадр без распознанного тела).
   *  hands — мировые ориентации кистей (переопределяют запястье аватара). */
  onPose: (pose: Pose | null, hands?: HandWorld) => void;
  /** Транзиентный статус для UI (распознаю / не вижу позу / сбой). */
  onStatus?: (text: string) => void;
  /** Жёсткая ошибка (нет доступа к камере, не загрузилась модель). */
  onError?: (message: string) => void;
  hands?: HandsMode;
  /** Поменять местами левую/правую кисти (калибровка зеркальности). */
  swapHands?: boolean;
}

export class CameraMirror {
  readonly video: HTMLVideoElement;
  /** Канвас-оверлей: граф кисти MediaPipe поверх видео (рисуется каждый кадр). */
  readonly overlay: HTMLCanvasElement;
  private opts: CameraMirrorOptions;
  private pose: PoseLandmarker | null = null;
  private hand: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private running = false;
  private lastTs = 0;
  private watchdog = 0;
  private gotResult = false;
  private missStreak = 0;
  // Сырой снимок последних кистей (для отладки ориентации в симуляции): метка
  // handedness MediaPipe + ориентиры в пиксельных коорд. [x·W, y·H, z·W].
  private lastRaw: { label: string; pts: Vec3[] }[] = [];

  constructor(opts: CameraMirrorOptions) {
    this.opts = opts;
    const v = document.createElement("video");
    v.playsInline = true;
    v.muted = true;
    v.autoplay = true;
    this.video = v;
    this.overlay = document.createElement("canvas");
  }

  setSwapHands(swap: boolean): void {
    this.opts = { ...this.opts, swapHands: swap };
  }

  setHands(hands: HandsMode): void {
    this.opts = { ...this.opts, hands };
  }

  /** Запустить захват. true — камера и модели готовы; false — отказ (см. onError). */
  async start(): Promise<boolean> {
    if (this.running) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
        audio: false,
      });
    } catch (e) {
      this.opts.onError?.(`Камера недоступна: ${(e as Error).message}`);
      return false;
    }
    this.video.srcObject = this.stream;
    try {
      await this.video.play();
    } catch {
      /* autoplay-политика — продолжаем, кадры всё равно пойдут */
    }

    try {
      restoreWasmStreaming(); // вернуть путь, затёртый CWASA, до загрузки модели
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      const makePose = (delegate: "GPU" | "CPU") =>
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: POSE_MODEL, delegate },
          runningMode: "VIDEO",
          numPoses: 1,
        });
      const makeHand = (delegate: "GPU" | "CPU") =>
        HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: HAND_MODEL, delegate },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.5,
        });
      try {
        this.pose = await makePose("GPU");
        this.hand = await makeHand("GPU");
      } catch (gpuErr) {
        console.warn("[cameraMirror] GPU-делегат не сработал, пробую CPU:", gpuErr);
        this.opts.onStatus?.("GPU-делегат недоступен — переключаюсь на CPU…");
        this.pose?.close();
        this.hand?.close();
        this.pose = null;
        this.hand = null;
        this.pose = await makePose("CPU");
        this.hand = await makeHand("CPU");
      }
    } catch (e) {
      console.error("[cameraMirror] не удалось создать landmarkers:", e);
      const diag = `streaming=${typeof WebAssembly.instantiateStreaming}`;
      this.opts.onError?.(`Модель не загрузилась: ${(e as Error).message || e} [${diag}]`);
      this.stopStream();
      return false;
    }

    this.running = true;
    this.gotResult = false;
    this.missStreak = 0;
    this.lastTs = 0;
    this.watchdog = window.setTimeout(() => {
      if (!this.gotResult) {
        this.opts.onError?.(
          "MediaPipe не даёт результат (12с). Откройте консоль (F12) — " +
            "возможно, не загрузились ассеты /mediapipe/tasks/ или модели.",
        );
      }
    }, WATCHDOG_MS);
    this.pump();
    return true;
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.watchdog) window.clearTimeout(this.watchdog);
    this.watchdog = 0;
    this.pose?.close();
    this.hand?.close();
    this.pose = null;
    this.hand = null;
    this.stopStream();
    // Самодостаточный teardown: убираем свои DOM-узлы из любого места вызова
    // (единый путь очистки — и из stopCamera, и из cleanup при размонтировании).
    this.video.remove();
    this.overlay.remove();
  }

  private stopStream(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  private pump = (): void => {
    if (!this.running || !this.pose || !this.hand) return;
    if (this.video.readyState >= 2 && this.video.videoWidth > 0) {
      // tasks-vision требует строго возрастающий timestamp на каждый detect.
      const ts = Math.max(Math.round(performance.now()), this.lastTs + 1);
      this.lastTs = ts;
      try {
        const poseRes = this.pose.detectForVideo(this.video, ts);
        const handRes = this.hand.detectForVideo(this.video, ts);
        this.handle(poseRes, handRes);
      } catch (e) {
        this.opts.onStatus?.(`Сбой кадра: ${(e as Error).message}`);
      }
    }
    if (this.running) this.raf = requestAnimationFrame(this.pump);
  };

  private handle(poseRes: PoseLandmarkerResult, handRes: HandLandmarkerResult): void {
    if (!this.gotResult) {
      this.gotResult = true;
      if (this.watchdog) window.clearTimeout(this.watchdog);
      this.opts.onStatus?.("Распознаю позу…");
    }

    this.drawOverlay(poseRes, handRes); // граф кисти/рук поверх видео

    const worlds = poseRes.worldLandmarks?.[0];
    if (!worlds || worlds.length < 25) {
      if (++this.missStreak % 30 === 1) {
        this.opts.onStatus?.("Не вижу позу — встаньте по пояс в кадр, ровный свет.");
      }
      this.opts.onPose(null);
      return;
    }
    this.missStreak = 0;

    const pl: Vec3[] = worlds.map((p) => [p.x, p.y, p.z]);
    const vis: number[] = worlds.map((p) => p.visibility ?? 1);

    const w = this.video.videoWidth || 640;
    const h = this.video.videoHeight || 480;
    let lh: Vec3[] | null = null;
    let rh: Vec3[] | null = null;
    const hands = handRes.landmarks ?? [];
    for (let i = 0; i < hands.length; i++) {
      const label = handRes.handedness?.[i]?.[0]?.categoryName; // "Left" | "Right"
      const pts: Vec3[] = hands[i].map((p) => [p.x * w, p.y * h, p.z * w]);
      if (label === "Right") rh = pts;
      else if (label === "Left") lh = pts;
    }
    if (this.opts.swapHands) {
      const tmp = lh;
      lh = rh;
      rh = tmp;
    }

    const mode = this.opts.hands ?? "both";
    const handsWorld: HandWorld = {};
    if (rh && (mode === "both" || mode === "r")) {
      const q = solveHandWorld(rh, "r");
      if (q) handsWorld.r = q; // null — вырожденный кадр, без переопределения кисти
    }
    if (lh && (mode === "both" || mode === "l")) {
      const q = solveHandWorld(lh, "l");
      if (q) handsWorld.l = q;
    }
    this.opts.onPose(frameToPose(pl, vis, lh, rh, mode), handsWorld);

    // Снимок сырых кистей (для отладки в симуляции) — до swap, с меткой MediaPipe.
    const raw: { label: string; pts: Vec3[] }[] = [];
    for (let i = 0; i < hands.length; i++) {
      const label = handRes.handedness?.[i]?.[0]?.categoryName ?? "?";
      raw.push({ label, pts: hands[i].map((p) => [p.x * w, p.y * h, p.z * w] as Vec3) });
    }
    this.lastRaw = raw;
  }

  /** Сырой снимок последних распознанных кистей (для отладочного экспорта). */
  getLastRaw(): { label: string; pts: Vec3[] }[] {
    return this.lastRaw;
  }

  /** Нарисовать граф MediaPipe (кисти + руки позы) на оверлее в пиксельных коорд. */
  private drawOverlay(poseRes: PoseLandmarkerResult, handRes: HandLandmarkerResult): void {
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    if (!w || !h) return;
    const cv = this.overlay;
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    // Руки позы (плечо→локоть→запястье) — приглушённо, для контекста.
    const pl = poseRes.landmarks?.[0];
    if (pl) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(148,163,184,0.55)";
      for (const [a, b] of POSE_ARM_CONNECTIONS) {
        if (!pl[a] || !pl[b]) continue;
        ctx.beginPath();
        ctx.moveTo(pl[a].x * w, pl[a].y * h);
        ctx.lineTo(pl[b].x * w, pl[b].y * h);
        ctx.stroke();
      }
    }

    // Кисти: правая — голубая, левая — оранжевая (handedness MediaPipe).
    const hands = handRes.landmarks ?? [];
    for (let i = 0; i < hands.length; i++) {
      const label = handRes.handedness?.[i]?.[0]?.categoryName;
      this.drawHand(ctx, hands[i] as LM[], w, h, label === "Right" ? "#22d3ee" : "#f59e0b");
    }
  }

  private drawHand(ctx: CanvasRenderingContext2D, lm: LM[], w: number, h: number, color: string): void {
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    for (const [a, b] of HAND_CONNECTIONS) {
      if (!lm[a] || !lm[b]) continue; // частичный результат MediaPipe — пропускаем связь
      ctx.beginPath();
      ctx.moveTo(lm[a].x * w, lm[a].y * h);
      ctx.lineTo(lm[b].x * w, lm[b].y * h);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    for (const p of lm) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
