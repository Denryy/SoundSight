// Плеер собственного 3D-аватара SoundSight.
//
// Отвечает за: сцену three.js (рендерер, камера, свет), проигрывание
// pose-track'ов от бэкенда (см. avatar/pose_synthesis.py), очередь жестов
// (зеркало контракта CwasaController), «дыхание» в простое и API для
// экрана «Аватар-лаб» (предпросмотр букв/клипов, статичная поза).
//
// Принцип таймлайна: трек разворачивается в массив ключей {t, ch}, где ch —
// ПОЛНЫЙ канальный срез (см. poseTypes.flattenPose). Частичные позы
// резолвятся кумулятивно при построении, поэтому сэмплирование — это просто
// поканальный лерп соседних ключей со сглаживанием.

import * as THREE from "three";

import { Humanoid } from "./humanoid";
import { SkinnedHumanoid } from "./skinnedHumanoid";
import {
  flattenPose,
  type Channels,
  type ClipFrame,
  type HandWorld,
  type NativeLexicon,
  type Pose,
  type PoseTrack,
} from "./poseTypes";
import { FS_ARM, FS_BASE, GAP_POSE, REST, letterDef } from "./poses";
import { ChannelEuroFilter } from "./oneEuro";

const MAX_QUEUE = 8; // как у CWASA: не копить отставание (ТЗ §6.6)

// Скиновая 3D-модель (Mixamo glTF в public/). null — только процедурный аватар.
// Модель грузится в фоне; пока не готова (или при ошибке) играет процедурный.
const SKINNED_MODEL_URL: string | null = "/models/connor.glb";

// Общий интерфейс тела: и процедурный Humanoid, и SkinnedHumanoid ему отвечают,
// поэтому плеер их взаимозаменяет, ничего не зная о внутренностях.
interface AvatarBody {
  readonly root: THREE.Object3D;
  applyChannels(ch: Channels): void;
  /** Переопределить мировую ориентацию кисти (live-зеркало) или снять (null). */
  setHandWorldOverride?(side: "r" | "l", q: THREE.Quaternion | null): void;
}

// Тайминги (мс) — подобраны под разборчивый, но живой темп дактиля.
const LETTER_TRANS = 135; // переход между буквами
const LETTER_HOLD = 320; // удержание буквы
const DOUBLE_DIP = 95; // «клевок» между одинаковыми буквами (лл, оо…)
const GLOSS_TRANS = 260; // вход в жест/стойку
const GAP_MS = 170; // пауза между словами
const REST_TRANS = 600; // возврат в позу покоя

// Live-зеркало (камера → аватар). Дрожь/лаг убирает 1€-фильтр (oneEuro.ts) на
// входе каждого кадра камеры; этот лерп лишь доинтерполирует ~30fps цель до 60fps
// рендера, поэтому может быть отзывчивее (раньше 0.35 нёс ещё и сглаживание).
const LIVE_SMOOTH = 0.5;
// Параметры 1€-фильтра для каналов-градусов: низкий срез в покое (давит дрожь),
// рост со скоростью (давит лаг). Подбираются на глаз в «Аватар-лаб».
const LIVE_MINCUTOFF = 1.0; // Гц
const LIVE_BETA = 0.02;     // рост среза на градус/сек скорости

interface Key {
  t: number;
  ch: Channels;
}

const REST_CH: Channels = flattenPose(REST);

function merged(cursor: Channels, p: Pose): Channels {
  return { ...cursor, ...flattenPose(p) };
}

/** Сэмпл таймлайна: лерп каналов между соседними ключами (smoothstep). */
function sample(keys: Key[], t: number): Channels {
  if (t <= keys[0].t) return keys[0].ch;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.ch;
  let i = 0;
  while (keys[i + 1].t < t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const span = Math.max(1, b.t - a.t);
  const u = (t - a.t) / span;
  const e = u * u * (3 - 2 * u);
  const out: Channels = {};
  for (const k in b.ch) {
    const av = a.ch[k] ?? 0;
    out[k] = av + ((b.ch[k] ?? 0) - av) * e;
  }
  return out;
}

type Mode = "idle" | "anim" | "static" | "live";

export class NativeAvatarController {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.1, 30);
  private humanoid: AvatarBody = new Humanoid();
  private renderer: THREE.WebGLRenderer | null = null;
  private container: HTMLElement | null = null;
  private resizeObs: ResizeObserver | null = null;
  private raf = 0;
  private running = false;
  private disposed = false;

  private lexicon: NativeLexicon | null = null;
  private queue: PoseTrack[] = [];
  private active: { keys: Key[]; start: number; thenRest: boolean } | null = null;
  private mode: Mode = "idle";
  private cur: Channels = { ...REST_CH };
  private liveTarget: Channels = { ...REST_CH }; // цель live-зеркала (после 1€-фильтра)
  private liveFilter = new ChannelEuroFilter(LIVE_MINCUTOFF, LIVE_BETA);
  // Мировые ориентации кистей из камеры (переопределяют запястье в live-режиме).
  private liveHands: { r: THREE.Quaternion | null; l: THREE.Quaternion | null } = { r: null, l: null };

  private ready = false;
  private readyListeners = new Set<(ready: boolean) => void>();

  constructor() {
    this.scene.add(this.humanoid.root);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x3a4150, 1.15);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 2.1);
    dir.position.set(1.4, 2.6, 2.4);
    this.scene.add(dir);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.55);
    fill.position.set(-1.8, 1.4, 1.2);
    this.scene.add(fill);

    this.camera.position.set(0, 1.38, 1.9);
    this.camera.lookAt(0, 1.28, 0);

    this.humanoid.applyChannels(this.cur);

    if (SKINNED_MODEL_URL) void this.loadSkinned(SKINNED_MODEL_URL);
  }

  /**
   * Подгрузить скиновую модель в фоне и бесшовно заменить ею процедурное тело.
   * При любой ошибке (нет файла, не WebGL, битый glTF) остаёмся на процедурном —
   * аватар никогда не «пропадает».
   */
  private async loadSkinned(url: string): Promise<void> {
    try {
      const skinned = new SkinnedHumanoid();
      await skinned.load(url);
      // Контроллер мог быть освобождён, пока грузилась модель (экран «Аватар-лаб»
      // размонтировался) — иначе ниже мы бы воскресили мёртвый аватар и подвесили
      // glTF/текстуры в утечку.
      if (this.disposed) {
        skinned.dispose();
        return;
      }
      this.scene.remove(this.humanoid.root);
      this.humanoid = skinned;
      this.scene.add(skinned.root);
      skinned.applyChannels(this.cur); // встать в текущую позу без рывка
    } catch (e) {
      console.warn("[avatar3d] скиновая модель не загружена, остаюсь на процедурном:", (e as Error).message);
    }
  }

  // ── Жизненный цикл сцены ────────────────────────────────────────────────

  /** Примонтировать canvas в контейнер. Безопасно вызывать повторно. */
  attach(container: HTMLElement): void {
    // Повторный attach = контроллер снова живой (важно для StrictMode в dev:
    // он делает mount→dispose→mount, иначе после dispose флаг навсегда гасил бы
    // applyLivePose и ронял скиновую модель в loadSkinned).
    this.disposed = false;
    if (!this.renderer) {
      try {
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      } catch (e) {
        console.warn("[avatar3d] WebGL недоступен:", (e as Error).message);
        return;
      }
    }
    if (this.container === container && container.contains(this.renderer.domElement)) {
      this.resize();
      return;
    }
    this.container = container;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";

    this.resizeObs?.disconnect();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();

    if (!this.running) {
      this.running = true;
      const loop = () => {
        this.raf = requestAnimationFrame(loop);
        this.tick();
      };
      this.raf = requestAnimationFrame(loop);
    }
    this.markReady();
  }

  /** Отцепить canvas (контейнер размонтируется). Таймлайны продолжают идти. */
  detach(): void {
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    if (this.renderer && this.container?.contains(this.renderer.domElement)) {
      this.container.removeChild(this.renderer.domElement);
    }
    this.container = null;
  }

  /** Полное освобождение ресурсов (для НЕ-синглтонных экземпляров — Лаб). */
  dispose(): void {
    this.disposed = true;
    this.detach();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.running = false;
    this.renderer?.dispose();
    this.renderer = null;
    this.readyListeners.clear();
  }

  private resize(): void {
    if (!this.renderer || !this.container) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return; // экран спрятан (display:none) — пропуск
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private markReady(): void {
    if (this.ready) return;
    this.ready = true;
    this.readyListeners.forEach((fn) => fn(true));
    this.drain();
  }

  isReady(): boolean {
    return this.ready;
  }

  onReadyChange(fn: (ready: boolean) => void): () => void {
    this.readyListeners.add(fn);
    fn(this.ready);
    return () => this.readyListeners.delete(fn);
  }

  // ── Данные ──────────────────────────────────────────────────────────────

  /** Лексикон глоссов (с бэкенда /avatar/native/lexicon — единый источник). */
  setLexicon(lex: NativeLexicon | null): void {
    this.lexicon = lex;
  }

  getLexicon(): NativeLexicon | null {
    return this.lexicon;
  }

  // ── Очередь треков (контракт как у cwasa.play) ──────────────────────────

  play(track: PoseTrack | null | undefined): void {
    if (!track || !Array.isArray(track.signs) || track.signs.length === 0) return;
    this.queue.push(track);
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
    this.drain();
  }

  clearQueue(): void {
    this.queue = [];
  }

  /** Остановить всё и плавно вернуться в покой (переключение движка). */
  stopAll(): void {
    this.queue = [];
    this.active = null;
    this.goRest();
  }

  private drain(): void {
    if (!this.ready || this.active || this.mode === "static") return;
    const track = this.queue.shift();
    if (!track) return;
    const keys = this.buildTrackKeys(track);
    if (keys.length < 2) {
      this.drain();
      return;
    }
    this.startTimeline(keys, true);
  }

  private startTimeline(keys: Key[], thenRest: boolean): void {
    this.active = { keys, start: performance.now(), thenRest };
    this.mode = "anim";
  }

  private goRest(): void {
    const keys: Key[] = [
      { t: 0, ch: { ...this.cur } },
      { t: REST_TRANS, ch: { ...REST_CH } },
    ];
    this.startTimeline(keys, false);
  }

  // ── Построение таймлайна из трека ───────────────────────────────────────

  private buildTrackKeys(track: PoseTrack): Key[] {
    let cursor: Channels = { ...this.cur };
    const keys: Key[] = [{ t: 0, ch: { ...cursor } }];
    let t = 0;

    const push = (at: number, ch: Channels) => {
      keys.push({ t: at, ch: { ...ch } });
    };

    for (const sign of track.signs) {
      if (sign.kind === "gloss") {
        const clip = this.lexicon?.glosses?.[sign.id];
        if (!clip?.frames?.length) {
          console.warn(`[avatar3d] глосс "${sign.id}" не найден в лексиконе — пропуск`);
          continue;
        }
        t = this.appendFrames(keys, cursor, t, GLOSS_TRANS, clip.frames, clip.hold ?? 180, (c) => {
          cursor = c;
        });
      } else if (sign.kind === "spell") {
        // Вход в стойку дактиля.
        cursor = merged(cursor, FS_BASE);
        t += GLOSS_TRANS;
        push(t, cursor);

        let prev = "";
        for (const raw of sign.letters) {
          const letter = raw.toLowerCase();
          const def = letterDef(sign.alphabet, letter);
          if (!def) {
            console.warn(`[avatar3d] нет формы буквы "${letter}" (${sign.alphabet}) — пропуск`);
            continue;
          }
          // «Клевок» между одинаковыми буквами, чтобы повтор был заметен.
          if (letter === prev) {
            t += DOUBLE_DIP;
            push(t, { ...cursor, "rArm.sh0": (cursor["rArm.sh0"] ?? 50) + 6 });
          }
          if ("pose" in def) {
            // Сброс руки в стойку + форма буквы (буква может переопределить руку).
            cursor = merged(merged(cursor, { rArm: FS_ARM }), def.pose);
            t += LETTER_TRANS;
            push(t, cursor);
            t += LETTER_HOLD;
            push(t, cursor);
          } else {
            const reset = merged(cursor, { rArm: FS_ARM });
            t = this.appendFrames(keys, reset, t, LETTER_TRANS, def.frames, def.hold ?? 120, (c) => {
              cursor = c;
            });
          }
          prev = letter;
        }
      } else {
        // gap — короткая пауза между словами.
        cursor = merged(cursor, GAP_POSE);
        t += GAP_MS;
        push(t, cursor);
      }
    }
    return keys;
  }

  /** Добавить кадры клипа (кумулятивно), вернуть новое t; колбэком — курсор. */
  private appendFrames(
    keys: Key[],
    startCursor: Channels,
    t: number,
    trans: number,
    frames: ClipFrame[],
    hold: number,
    setCursor: (c: Channels) => void,
  ): number {
    let cursor = startCursor;
    const tStart = t + trans;
    for (const f of frames) {
      cursor = merged(cursor, f.pose);
      keys.push({ t: tStart + f.t, ch: { ...cursor } });
    }
    const end = tStart + frames[frames.length - 1].t + hold;
    keys.push({ t: end, ch: { ...cursor } });
    setCursor(cursor);
    return end;
  }

  // ── API для «Аватар-лаб» ────────────────────────────────────────────────

  /** Проиграть одну букву (с входом в стойку дактиля). */
  previewLetter(alphabet: "asl" | "ru", letter: string): void {
    this.playImmediate({ v: 1, signs: [{ kind: "spell", alphabet, letters: [letter] }] });
  }

  /** Проиграть произвольное слово дактилем. */
  previewSpell(alphabet: "asl" | "ru", letters: string[]): void {
    this.playImmediate({ v: 1, signs: [{ kind: "spell", alphabet, letters }] });
  }

  /** Проиграть клип (кадры глосса) без обращения к лексикону. */
  previewClip(frames: ClipFrame[], hold = 180): void {
    if (!frames?.length) return;
    this.queue = [];
    this.mode = "anim";
    let cursor: Channels = { ...this.cur };
    const keys: Key[] = [{ t: 0, ch: { ...cursor } }];
    this.appendFrames(keys, cursor, 0, GLOSS_TRANS, frames, hold, (c) => {
      cursor = c;
    });
    this.startTimeline(keys, true);
  }

  /** Мгновенно (за короткий переход) встать в статичную позу — для слайдеров. */
  applyStaticPose(pose: Pose): void {
    this.queue = [];
    this.active = null;
    this.mode = "static";
    this.cur = merged({ ...REST_CH }, pose);
  }

  /** Выйти из статичного режима обратно в покой/очередь. */
  resumeIdle(): void {
    this.mode = "anim";
    this.goRest();
  }

  // ── Live-зеркало (камера → аватар) ──────────────────────────────────────
  // Каждый кадр MediaPipe даёт частичную позу; держим её целью, а tick плавно
  // подтягивает к ней текущую позу (сглаживание дрожания распознавания).

  /** Обновить цель живого зеркала позой кадра (вход в режим «live»). */
  applyLivePose(pose: Pose, hands?: HandWorld): void {
    if (this.disposed) return; // кадр камеры пришёл после освобождения — игнор
    const entering = this.mode !== "live";
    this.queue = [];
    this.active = null;
    this.mode = "live";
    if (entering) this.liveFilter.reset(); // не тянуть состояние из прошлого сеанса
    // 1€-фильтр поканально по реальному dt кадров камеры → де-джиттернутая цель.
    const target = merged({ ...REST_CH }, pose);
    this.liveTarget = this.liveFilter.filter(target, performance.now());
    // Ориентация кистей — мировым кватернионом (минуя tw/wr): стабильно, без торса.
    this.liveHands.r = hands?.r ? new THREE.Quaternion(hands.r.x, hands.r.y, hands.r.z, hands.r.w) : null;
    this.liveHands.l = hands?.l ? new THREE.Quaternion(hands.l.x, hands.l.y, hands.l.z, hands.l.w) : null;
  }

  /** Выйти из живого зеркала и плавно вернуться в покой. */
  stopMirror(): void {
    if (this.mode !== "live") return;
    this.mode = "anim";
    this.goRest();
  }

  private playImmediate(track: PoseTrack): void {
    this.queue = [];
    this.mode = "anim";
    this.active = null;
    const keys = this.buildTrackKeys(track);
    if (keys.length >= 2) this.startTimeline(keys, true);
  }

  // ── Кадр ────────────────────────────────────────────────────────────────

  private tick(): void {
    const now = performance.now();

    // Live-зеркало: плавно подтягиваем текущую позу к цели кадра камеры.
    if (this.mode === "live") {
      const next: Channels = { ...this.cur };
      for (const k in this.liveTarget) {
        const tv = this.liveTarget[k] ?? 0;
        const cv = this.cur[k] ?? tv;
        next[k] = cv + (tv - cv) * LIVE_SMOOTH;
      }
      this.cur = next;
      // Кисти — мировым кватернионом поверх каналов (стабильная ориентация).
      this.humanoid.setHandWorldOverride?.("r", this.liveHands.r);
      this.humanoid.setHandWorldOverride?.("l", this.liveHands.l);
      this.humanoid.applyChannels(this.cur);
      if (this.renderer && this.container && this.container.clientWidth > 0) {
        this.renderer.render(this.scene, this.camera);
      }
      return;
    }

    if (this.active) {
      const t = now - this.active.start;
      this.cur = sample(this.active.keys, t);
      if (t >= this.active.keys[this.active.keys.length - 1].t) {
        const thenRest = this.active.thenRest;
        this.active = null;
        if (this.queue.length > 0) {
          this.drain();
        } else if (thenRest) {
          this.goRest();
        } else {
          this.mode = "idle";
        }
      }
    }

    let frame = this.cur;
    if (this.mode === "idle") {
      // «Дыхание»: лёгкие синусоидальные смещения поверх позы покоя.
      const b = Math.sin(now / 1900);
      const b2 = Math.sin(now / 2300 + 1.1);
      frame = { ...this.cur };
      frame["spine0"] = (frame["spine0"] ?? 0) + b * 1.1;
      frame["head0"] = (frame["head0"] ?? 0) + b2 * 0.9;
      frame["rArm.sh1"] = (frame["rArm.sh1"] ?? 0) + b * 0.7;
      frame["lArm.sh1"] = (frame["lArm.sh1"] ?? 0) + b * 0.7;
    }
    // Вне live-режима снимаем переопределение кисти (жесты/дактиль рисуют сами).
    this.humanoid.setHandWorldOverride?.("r", null);
    this.humanoid.setHandWorldOverride?.("l", null);
    this.humanoid.applyChannels(frame);

    if (this.renderer && this.container && this.container.clientWidth > 0) {
      this.renderer.render(this.scene, this.camera);
    }
  }
}

// Единый экземпляр на приложение (живая сессия). «Аватар-лаб» создаёт СВОЙ
// экземпляр, чтобы не отбирать canvas у примонтированного экрана субтитров.
export const nativeAvatar = new NativeAvatarController();
