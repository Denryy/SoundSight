// 1€ (One-Euro) фильтр — адаптивное сглаживание шумного сигнала в реальном
// времени. Casiez, Roussel, Vogel, «1€ filter: a simple speed-based low-pass
// filter for noisy input in interactive systems», CHI 2012.
//
// Зачем: живое зеркало (камера → MediaPipe → ретаргет) даёт дрожащий поток поз.
// Постоянный лерп (как был в player.ts) — это компромисс «дрожит или запаздывает»:
// сильное сглаживание убирает дрожь, но добавляет лаг; слабое — наоборот.
// 1€-фильтр решает это адаптивной частотой среза: МЕДЛЕННО → низкий срез (давим
// дрожь), БЫСТРО → высокий срез (давим лаг). Человек чувствителен к дрожи в
// покое и к лагу в движении — фильтр под это и подстроен.
//
// Каналы поз — это градусы (см. poseTypes.ts), не оборачиваются на ±180, поэтому
// фильтруем их как обычные скаляры, поканально (у каждого канала своя скорость →
// своя адаптация). Только erasable-TS: Node стрипает типы для офлайн-теста
// (ml/one_euro_test.mjs), как и poseRetarget.ts.

import type { Channels } from "./poseTypes";

const TWO_PI = Math.PI * 2;

/** Коэффициент сглаживания α = 1/(1 + τ/Te), τ = 1/(2π·fc). */
function smoothingAlpha(cutoffHz: number, dtSec: number): number {
  const tau = 1 / (TWO_PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

/** Один скалярный 1€-фильтр. */
export class OneEuroFilter {
  private readonly minCutoff: number; // частота среза в покое, Гц
  private readonly beta: number;      // насколько срез растёт со скоростью
  private readonly dCutoff: number;   // срез фильтра производной, Гц
  private xPrev = 0;
  private dxPrev = 0;
  private tPrev = 0; // мс
  private primed = false;

  constructor(minCutoff = 1.0, beta = 0.02, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  /** Сбросить состояние (при входе в новый сеанс зеркала). */
  reset(): void {
    this.primed = false;
    this.xPrev = 0;
    this.dxPrev = 0;
    this.tPrev = 0;
  }

  /** Отфильтровать очередной отсчёт x с меткой времени tMs (мс). */
  filter(x: number, tMs: number): number {
    // Защита от NaN/Infinity: иначе один битый отсчёт заразит канал навсегда
    // (xPrev=NaN → все последующие кадры NaN).
    if (!Number.isFinite(x)) return this.primed ? this.xPrev : 0;
    if (!this.primed) {
      this.primed = true;
      this.xPrev = x;
      this.dxPrev = 0;
      this.tPrev = tMs;
      return x;
    }
    // dt из реальных меток; защита от нулевого/неубывающего времени (~60fps).
    let dt = (tMs - this.tPrev) / 1000;
    if (!(dt > 0)) dt = 1 / 60;
    this.tPrev = tMs;

    // Производная сигнала, сглаженная фиксированным срезом dCutoff.
    const dx = (x - this.xPrev) / dt;
    const aD = smoothingAlpha(this.dCutoff, dt);
    const edx = aD * dx + (1 - aD) * this.dxPrev;
    this.dxPrev = edx;

    // Адаптивный срез растёт со скоростью движения.
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const a = smoothingAlpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    return xHat;
  }
}

/**
 * 1€-фильтр для карты каналов позы: у каждого канала свой независимый фильтр,
 * создаётся лениво. Незаданные в кадре каналы просто не трогаются.
 */
export class ChannelEuroFilter {
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly dCutoff: number;
  private readonly filters = new Map<string, OneEuroFilter>();

  constructor(minCutoff = 1.0, beta = 0.02, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  /** Сбросить все поканальные фильтры. */
  reset(): void {
    this.filters.clear();
  }

  /** Вернуть новую карту каналов, сглаженную поканально на метке времени tMs. */
  filter(channels: Channels, tMs: number): Channels {
    const out: Channels = {};
    for (const k in channels) {
      let f = this.filters.get(k);
      if (!f) {
        f = new OneEuroFilter(this.minCutoff, this.beta, this.dCutoff);
        this.filters.set(k, f);
      }
      out[k] = f.filter(channels[k], tMs);
    }
    return out;
  }
}
