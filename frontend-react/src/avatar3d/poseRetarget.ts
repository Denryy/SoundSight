// Ретаргет ориентиров MediaPipe → контракт поз аватара (poseTypes.ts).
//
// Прямой порт математики из ml/extract_pose_clip.py (та же, что строит клипы из
// видео), но для ЖИВОГО потока с веб-камеры в браузере. Чистая векторная
// геометрия: углы меряются в торсовой системе координат, поэтому ракурс камеры
// не важен. Эрейзабл-TS — Node умеет стрипнуть типы для офлайн-теста
// (ml/retarget_pose_test.mjs), как ml/extract_pose_clip.py --self-test.
//
// Точность (честно, как в Python): подъём/отведение плеча, локоть и сгибы
// пальцев устойчивы; вращение предплечья (tw), осевое плечо (rot) и кисть (wr)
// из ОДНОЙ камеры оцениваются приблизительно.

import type { ArmPose, HandPose, Pose } from "./poseTypes";

// ── Индексы ориентиров MediaPipe (совпадают с extract_pose_clip.py) ──────────
const P_NOSE = 0, P_LEAR = 7, P_REAR = 8;
const P_LSH = 11, P_RSH = 12, P_LEL = 13, P_REL = 14, P_LWR = 15, P_RWR = 16;
const P_LHIP = 23, P_RHIP = 24;

const H_WRIST = 0;
const H_THUMB: [number, number, number, number] = [1, 2, 3, 4]; // CMC, MCP, IP, TIP
const H_FINGERS: Record<string, [number, number, number, number]> = {
  index: [5, 6, 7, 8], // MCP, PIP, DIP, TIP
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
};

const VIS_MIN = 0.5; // минимальная visibility ориентира руки (pose)
const ELBOW_FOR_ROT = 20.0; // rot плеча осмыслен только при согнутом локте, °
const SPREAD_NOISE = 6.0; // |spread| ниже порога не пишем (шум), °

export type Vec3 = [number, number, number];

// ── Конвенции ориентации кисти (живое зеркало) — АВТОМАТИЧЕСКИ, без крутилок ──
// Математика ретаргета портирована с MediaPipe Holistic; live-зеркало использует
// tasks-vision HandLandmarker, у которого нормаль ладони и знак сгиба кисти
// противоположны (см. Kalidokit: палм-базис из wrist+index_mcp+pinky_mcp). Это
// ФИКСИРОВАННЫЕ конвенции пайплайна, не пользовательские. Если на реальном риге
// ориентация всё же зеркальна — это правится сменой true/false ровно здесь
// (одна правка кода), а не ручной калибровкой в UI.
const TV_FLIP_PALM = true; // нормаль ладони наоборот (иначе аватар кажет тыл)
const TV_FLIP_FLEX = true; // сгиб кисти наоборот (иначе пальцы смотрят вниз)
// Голова в live-зеркале выключена: её расчёт опирается на плечи (торс-система),
// которые двигаются с руками → голова ехала за руками. См. frameToPose.
const LIVE_HEAD = false;

// ── Векторная геометрия ──────────────────────────────────────────────────────
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
const avg = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
const DEG = 180 / Math.PI;
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const r = (x: number): number => Math.round(x);

function unit(v: Vec3): Vec3 {
  const n = norm(v);
  return n > 1e-9 ? [v[0] / n, v[1] / n, v[2] / n] : [0, 0, 0];
}

/** Составляющая v, перпендикулярная оси axis (axis — единичный). */
function perp(v: Vec3, axis: Vec3): Vec3 {
  return sub(v, scale(axis, dot(v, axis)));
}

/** Невзвешенный угол между векторами, градусы [0..180]. */
function ang(a: Vec3, b: Vec3): number {
  return Math.acos(clamp(dot(unit(a), unit(b)), -1, 1)) * DEG;
}

const isZero = (v: Vec3): boolean => v[0] === 0 && v[1] === 0 && v[2] === 0;

/** Знаковый угол от vFrom к vTo вокруг axis (правило правой руки), °. */
function signedAbout(axis: Vec3, vFrom: Vec3, vTo: Vec3): number {
  const a = unit(axis);
  const f = unit(perp(vFrom, a));
  const t = unit(perp(vTo, a));
  if (isZero(f) || isZero(t)) return 0;
  return Math.atan2(dot(cross(f, t), a), clamp(dot(f, t), -1, 1)) * DEG;
}

/** Сгиб сустава между последовательными сегментами →a и →b. */
const bend = (a: Vec3, b: Vec3): number => ang(a, b);

// ── Торсовая система координат ───────────────────────────────────────────────
export interface Torso {
  up: Vec3;
  fwd: Vec3;
  toRight: Vec3; // к правому плечу ЧЕЛОВЕКА
}

export function makeTorso(pl: Vec3[]): Torso {
  const midSh = avg(pl[P_LSH], pl[P_RSH]);
  const midHip = avg(pl[P_LHIP], pl[P_RHIP]);
  const up = unit(sub(midSh, midHip));
  const toRight0 = unit(perp(sub(pl[P_RSH], pl[P_LSH]), up));
  let fwd = unit(cross(toRight0, up));
  if (dot(sub(pl[P_NOSE], midSh), fwd) < 0) fwd = neg(fwd); // нос «спереди»
  let toRight = unit(cross(up, fwd));
  if (dot(toRight, toRight0) < 0) toRight = neg(toRight); // сохранить «право человека»
  return { up, fwd, toRight };
}

// ── Ретаргет: рука (плечо/локоть/предплечье) ─────────────────────────────────
export function retargetArm(
  side: "r" | "l",
  pl: Vec3[],
  vis: number[],
  t: Torso,
  palmN: Vec3 | null,
): ArmPose | null {
  const [iSh, iEl, iWr] = side === "r" ? [P_RSH, P_REL, P_RWR] : [P_LSH, P_LEL, P_LWR];
  if (Math.min(vis[iSh], vis[iEl], vis[iWr]) < VIS_MIN) return null;

  const upper = sub(pl[iEl], pl[iSh]);
  const fore = sub(pl[iWr], pl[iEl]);
  const u = unit(upper);
  const f = unit(fore);
  const lateral = side === "r" ? t.toRight : neg(t.toRight);

  const raise = Math.atan2(dot(u, t.fwd), -dot(u, t.up)) * DEG;
  const sideAng = Math.asin(clamp(dot(u, lateral), -1, 1)) * DEG;
  const el = bend(upper, fore);

  // Осевое вращение плеча: куда «смотрит» сгиб локтя относительно «вперёд».
  let rot = 0;
  if (el > ELBOW_FOR_ROT) {
    let ref = unit(perp(t.fwd, u));
    if (norm(ref) < 1e-6) ref = unit(perp(neg(t.up), u)); // рука точно вперёд
    const aF = signedAbout(u, ref, f);
    const aLat = signedAbout(u, ref, lateral);
    rot = aLat >= 0 ? aF : -aF;
  }

  const arm: ArmPose = { sh: [r(raise), r(sideAng), r(rot)], el: r(el) };

  // Вращение предплечья из ладонной нормали. tw=0 — ладонь к телу.
  if (palmN !== null && norm(fore) > 1e-6) {
    const n0 = unit(perp(neg(lateral), f));
    const aN = signedAbout(f, n0, palmN);
    arm.tw = r(side === "r" ? -aN : aN);
  }
  return arm;
}

// ── Ретаргет: кисть и пальцы ─────────────────────────────────────────────────
export function palmNormal(side: "r" | "l", hl: Vec3[]): Vec3 {
  const vi = sub(hl[H_FINGERS.index[0]], hl[H_WRIST]);
  const vp = sub(hl[H_FINGERS.pinky[0]], hl[H_WRIST]);
  const n = side === "r" ? cross(vi, vp) : cross(vp, vi);
  return unit(n);
}

export function retargetHand(
  side: "r" | "l",
  hl: Vec3[],
  fore: Vec3 | null,
): { hand: HandPose; wr: [number, number] | null } {
  const w = hl[H_WRIST];
  const n = palmNormal(side, hl);
  const midDir = unit(sub(hl[H_FINGERS.middle[0]], w));
  const radial = unit(perp(perp(sub(hl[H_THUMB[0]], w), midDir), n)); // к большому пальцу

  const hand: HandPose = {};
  const sa = signedAbout(n, midDir, radial);
  const spreadSign = Math.sign(sa || 1) || 1;

  for (const name of ["index", "middle", "ring", "pinky"] as const) {
    const [mcp, pip, dip, tip] = H_FINGERS[name];
    const meta = sub(hl[mcp], w);
    const prox = sub(hl[pip], hl[mcp]);
    const c0 = bend(meta, prox);
    const c1 = bend(prox, sub(hl[dip], hl[pip]));
    const c2 = bend(sub(hl[dip], hl[pip]), sub(hl[tip], hl[dip]));
    const fp = hand[name] ?? {};
    fp.curl = [r(clamp(c0, 0, 115)), r(clamp(c1, 0, 115)), r(clamp(c2, 0, 115))];
    if (name !== "middle") {
      let sp = signedAbout(n, midDir, unit(prox)) * spreadSign;
      if (name === "ring" || name === "pinky") sp = -sp; // «+» = от среднего пальца
      if (Math.abs(sp) >= SPREAD_NOISE) fp.spread = r(clamp(sp, -20, 35));
    }
    hand[name] = fp;
  }

  // Большой палец: spread — в плоскости ладони, oppose — поперёк неё.
  const [cmc, tmcp, ip, ttip] = H_THUMB;
  const tdir = sub(hl[tmcp], hl[cmc]);
  const tIn = perp(tdir, n);
  const spread = norm(tIn) > 1e-6 ? ang(tIn, midDir) : 0;
  const oppose = Math.atan2(dot(unit(tdir), n), norm(tIn) / (norm(tdir) + 1e-9)) * DEG;
  hand.thumb = {
    spread: r(clamp(spread, 0, 60)),
    oppose: r(clamp(oppose, 0, 70)),
    curl: [
      r(clamp(bend(tdir, sub(hl[ip], hl[tmcp])), 0, 100)),
      r(clamp(bend(sub(hl[ip], hl[tmcp]), sub(hl[ttip], hl[ip])), 0, 100)),
    ],
  };

  let wr: [number, number] | null = null;
  if (fore !== null) {
    const a = unit(fore);
    const h = sub(hl[H_FINGERS.middle[0]], w);
    const flex = Math.atan2(dot(h, n), dot(h, a)) * DEG;
    const hIn = perp(h, n);
    const dev = Math.atan2(dot(h, radial), dot(unit(hIn), a) * norm(hIn) + 1e-9) * DEG;
    wr = [r(clamp(flex, -70, 80)), r(clamp(dev, -40, 40))];
  }
  return { hand, wr };
}

// ── Ретаргет: голова ─────────────────────────────────────────────────────────
function retargetHead(pl: Vec3[], vis: number[], t: Torso): [number, number, number] | null {
  if (Math.min(vis[P_NOSE], vis[P_LEAR], vis[P_REAR]) < VIS_MIN) return null;
  const face = sub(pl[P_NOSE], avg(pl[P_LEAR], pl[P_REAR]));
  const nod = Math.atan2(dot(face, neg(t.up)), dot(face, t.fwd)) * DEG;
  const turn = Math.atan2(dot(face, neg(t.toRight)), dot(face, t.fwd)) * DEG;
  if (Math.abs(nod) < 6 && Math.abs(turn) < 6) return null; // почти нейтраль
  return [r(clamp(nod, -30, 35)), r(clamp(turn, -45, 45)), 0];
}

// ── Кадр → частичная поза ────────────────────────────────────────────────────
export type HandsMode = "both" | "r" | "l";

/**
 * Полный ретаргет одного кадра MediaPipe в частичную позу аватара.
 *
 * @param pl  33 мировых ориентира pose (метры), Vec3[]
 * @param vis visibility каждого pose-ориентира (33)
 * @param lh  21 ориентир ЛЕВОЙ кисти в «пиксельных» коорд. (x·W, y·H, z·W) или null
 * @param rh  21 ориентир ПРАВОЙ кисти или null
 */
export function frameToPose(
  pl: Vec3[],
  vis: number[],
  lh: Vec3[] | null,
  rh: Vec3[] | null,
  hands: HandsMode = "both",
): Pose {
  const t = makeTorso(pl);
  const pose: Pose = {};
  const sides: Array<["r" | "l", Vec3[] | null, "rArm" | "lArm", "rHand" | "lHand"]> = [
    ["r", rh, "rArm", "rHand"],
    ["l", lh, "lArm", "lHand"],
  ];
  for (const [side, hl, armKey, handKey] of sides) {
    if (hands !== "both" && hands !== side) continue;
    // Ориентация ладони: инвертируем палм-нормаль (tasks-vision ↔ Holistic) → tw
    // даёт верную сторону ладони. Сгибы/спред пальцев считаются из своей нормали
    // внутри retargetHand и остаются корректными независимо от этого.
    let n = hl ? palmNormal(side, hl) : null;
    if (n && TV_FLIP_PALM) n = neg(n);
    const arm = retargetArm(side, pl, vis, t, n);
    if (!arm) continue;
    const [iEl, iWr] = side === "r" ? [P_REL, P_RWR] : [P_LEL, P_LWR];
    const fore = sub(pl[iWr], pl[iEl]);
    if (hl) {
      const { hand, wr } = retargetHand(side, hl, fore);
      pose[handKey] = hand;
      if (wr) {
        if (TV_FLIP_FLEX) wr[0] = -wr[0]; // сгиб кисти: пальцы вверх, а не вниз
        arm.wr = wr;
      }
    }
    pose[armKey] = arm;
  }
  // Голову в live-зеркале НЕ ведём: retargetHead опирается на торс-систему
  // (makeTorso → плечи), а плечевые точки смещаются при подъёме рук, из-за чего
  // голова «ехала» за руками. Для независимого слежения нужен расчёт из лицевых
  // ориентиров (нос/уши/глаза), а не из торс-системы — отдельная задача.
  const head = LIVE_HEAD ? retargetHead(pl, vis, t) : null;
  if (head) pose.head = head;
  return pose;
}

// ── Прореживание ключевых кадров (порт thin_keyframes) ───────────────────────
export interface RetargetFrame {
  t: number;
  pose: Pose;
}

function flatten(pose: unknown, prefix: string, out: Record<string, number>): void {
  if (pose === null || typeof pose !== "object") return;
  for (const [k, v] of Object.entries(pose as Record<string, unknown>)) {
    const key = prefix + k;
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        if (typeof x === "number") out[`${key}${i}`] = x;
      });
    } else if (v !== null && typeof v === "object") {
      flatten(v, key + ".", out);
    } else if (typeof v === "number") {
      out[key] = v;
    }
  }
}

/**
 * Оставляем кадр, если хоть один канал ушёл от последнего ключевого более чем
 * на minDelta° или прошло maxGapMs. Первый/последний — всегда.
 */
export function thinKeyframes(
  frames: RetargetFrame[],
  minDelta = 4.0,
  maxGapMs = 400,
): RetargetFrame[] {
  if (frames.length <= 2) return frames;
  const kept: RetargetFrame[] = [frames[0]];
  let last: Record<string, number> = {};
  flatten(frames[0].pose, "", last);
  for (let i = 1; i < frames.length - 1; i++) {
    const fr = frames[i];
    const cur: Record<string, number> = {};
    flatten(fr.pose, "", cur);
    const keys = new Set([...Object.keys(last), ...Object.keys(cur)]);
    let delta = 0;
    for (const k of keys) delta = Math.max(delta, Math.abs((cur[k] ?? 0) - (last[k] ?? 0)));
    if (delta >= minDelta || fr.t - kept[kept.length - 1].t >= maxGapMs) {
      kept.push(fr);
      last = cur;
    }
  }
  kept.push(frames[frames.length - 1]);
  return kept;
}
