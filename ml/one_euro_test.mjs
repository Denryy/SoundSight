// Офлайн-проверка 1€-фильтра (frontend-react/src/avatar3d/oneEuro.ts) — того,
// что сглаживает живое зеркало. Импортирует .ts напрямую (Node ≥23.6 стрипает
// типы). Запуск:  node ml/one_euro_test.mjs
//
// Проверяем ДВА свойства, ради которых фильтр и взят: в ПОКОЕ давит дрожь
// сильнее старого постоянного лерпа, а в ДВИЖЕНИИ — отзывчивее его (меньше лаг).
// Детерминированный псевдошум (без Math.random) — тест воспроизводим.

import { OneEuroFilter, ChannelEuroFilter } from "../frontend-react/src/avatar3d/oneEuro.ts";

let fails = 0;
const ok = (cond, msg) => {
  console.log(cond ? "ok  " : "FAIL", msg);
  if (!cond) fails++;
};

const FPS = 30;
const DT = 1000 / FPS; // мс на кадр камеры
const tAt = (i) => i * DT;

// Эталон для сравнения — СТАРЫЙ live-режим: постоянный лерп LIVE_SMOOTH=0.35.
// Показываем, что 1€ одновременно (а) глаже его в покое и (б) не медленнее в
// движении — то, чего постоянным коэффициентом сразу не добиться.
const OLD_LERP = 0.35;

// Детерминированный белый шум (LCG, без Math.random): кадр-к-кадру некоррелирован —
// реалистичная модель дрожания ориентиров (в отличие от гладкой синусоиды).
function whiteNoise(n, amp) {
  let s = 0x9e3779b1 >>> 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    out.push(((s / 0xffffffff) * 2 - 1) * amp);
  }
  return out;
}

function fixedAlpha(values, a) {
  let y = values[0];
  const out = [y];
  for (let i = 1; i < values.length; i++) {
    y = a * values[i] + (1 - a) * y;
    out.push(y);
  }
  return out;
}

const dev = (arr, target) => Math.max(...arr.map((x) => Math.abs(x - target)));

// ── 1) Первый отсчёт проходит как есть ───────────────────────────────────────
{
  const f = new OneEuroFilter(1.0, 0.02);
  ok(f.filter(42, 0) === 42, "первый отсчёт = вход (нет разогрева — нет скачка)");
}

// ── 2) Покой: дрожь давится сильнее старого постоянного лерпа ────────────────
{
  const N = 120;
  const CONST = 50;
  const noise = whiteNoise(N, 3); // ±3° белого шума вокруг постоянного значения
  const noisy = noise.map((d) => CONST + d);

  const f = new OneEuroFilter(1.0, 0.02);
  const euro = noisy.map((x, i) => f.filter(x, tAt(i)));
  const fixed = fixedAlpha(noisy, OLD_LERP);

  const tail = (a) => a.slice(50); // после разогрева
  const inDev = dev(tail(noisy), CONST);
  const euroDev = dev(tail(euro), CONST);
  const fixedDev = dev(tail(fixed), CONST);
  console.log(`     покой: вход ±${inDev.toFixed(2)}°  →  1€ ±${euroDev.toFixed(2)}°  (старый лерп ±${fixedDev.toFixed(2)}°)`);
  ok(euroDev < fixedDev, "в покое 1€ глаже старого лерпа 0.35");
  ok(euroDev < inDev * 0.6, "1€ режет дрожь в покое более чем вдвое");
}

// ── 3) Движение (шаг): 1€ не медленнее старого лерпа, лаг низкий ─────────────
{
  const N = 40;
  const STEP = 12;
  const TARGET = 90;
  const sig = [];
  for (let i = 0; i < N; i++) sig.push(i < STEP ? 0 : TARGET);

  const f = new OneEuroFilter(1.0, 0.02);
  const euro = sig.map((x, i) => f.filter(x, tAt(i)));
  const fixed = fixedAlpha(sig, OLD_LERP);

  const probe = STEP + 3;
  console.log(`     шаг 0→90: через 3 кадра  1€=${euro[probe].toFixed(1)}  старый лерп=${fixed[probe].toFixed(1)}`);
  ok(euro[probe] >= 70, "1€ через 3 кадра после шага уже >70° (низкий лаг)");
  ok(euro[probe] >= fixed[probe] - 1, "1€ не медленнее старого лерпа на шаге");
}

// ── 4) Движение (рамп): установившийся лаг 1€ не больше, чем у лерпа ──────────
{
  const N = 60;
  const ramp = [];
  for (let i = 0; i < N; i++) ramp.push(i * 4); // 4°/кадр = 120°/с

  const f = new OneEuroFilter(1.0, 0.02);
  const euro = ramp.map((x, i) => f.filter(x, tAt(i)));
  const fixed = fixedAlpha(ramp, OLD_LERP);

  const euroLag = ramp[N - 1] - euro[N - 1];
  const fixedLag = ramp[N - 1] - fixed[N - 1];
  console.log(`     рамп: лаг 1€=${euroLag.toFixed(1)}°  старый лерп=${fixedLag.toFixed(1)}°`);
  ok(euroLag <= fixedLag + 0.5, "на непрерывном движении лаг 1€ не больше старого");
}

// ── 5) Защита от нулевого/неубывающего dt — без NaN ──────────────────────────
{
  const f = new OneEuroFilter(1.0, 0.02);
  f.filter(10, 1000);
  const y = f.filter(20, 1000); // тот же timestamp
  ok(Number.isFinite(y), "одинаковый timestamp не даёт NaN (защита dt)");
}

// ── 6) Поканальный фильтр: каналы независимы, reset чистит состояние ──────────
{
  const cf = new ChannelEuroFilter(1.0, 0.02);
  const out0 = cf.filter({ "rArm.el": 100, "rArm.sh0": 0 }, 0);
  ok(out0["rArm.el"] === 100 && out0["rArm.sh0"] === 0, "каналы фильтруются независимо (первый кадр = вход)");
  cf.reset();
  const out1 = cf.filter({ "rArm.el": 50 }, 0);
  ok(out1["rArm.el"] === 50, "reset сбрасывает поканальное состояние");
}

console.log(fails === 0 ? "\n1€-фильтр: OK" : `\n1€-фильтр: ПРОВАЛ (${fails})`);
process.exit(fails ? 1 : 0);
