// Offline-проверка ЗНАКА разведения пальцев в пальцевом ретаргете
// (skinnedHumanoid.ts). Сгиб уже покрыт ml/retarget_test.mjs; здесь — критичный
// геометрический инвариант, который в браузере виден, а в CI нет:
//
//   ОДИН знак на кисть (spreadSign) + направление каждого пальца, закодированное
//   драйвером (SPREAD_DIR), должны разводить ВСЕ пальцы ВЕЕРОМ «от среднего».
//   Ошибка знака даёт обратное — пальцы скрещиваются, и буквы сливаются.
//
// Формулы palmNormal / spreadSign и рантайм-композиция здесь повторены вручную
// (как и в retarget_test.mjs) — при правке источника синхронизировать.

import * as THREE from "../frontend-react/node_modules/three/build/three.module.js";

const V = THREE.Vector3;
const wpos = (m, k) => m.get(k).clone();

// SPREAD_DIR из humanoid.ts: куда «растопыривается» палец относительно среднего.
const SPREAD_DIR = { Index: 1, Middle: 0.3, Ring: -0.7, Pinky: -1 };

// ── Синтетическая ПРАВАЯ кисть: ладонь смотрит в +Z, пальцы вверх (+Y) ──
// (мизинец смещён в −X, указательный в +X — как FINGER_X в humanoid.ts.)
const bones = new Map([
  ["RightHand", new V(0, 0, 0)],
  ["RightHandIndex1", new V(0.03, 0.08, 0)],
  ["RightHandIndex4", new V(0.03, 0.18, 0)],
  ["RightHandMiddle1", new V(0.01, 0.085, 0)],
  ["RightHandMiddle4", new V(0.01, 0.19, 0)],
  ["RightHandRing1", new V(-0.01, 0.083, 0)],
  ["RightHandRing4", new V(-0.01, 0.185, 0)],
  ["RightHandPinky1", new V(-0.03, 0.078, 0)],
  ["RightHandPinky4", new V(-0.03, 0.17, 0)],
]);

// palmNormal (как в источнике): (Index1−Hand) × (Pinky1−Hand).
function palmNormal(side) {
  const w = wpos(bones, side + "Hand");
  const i = wpos(bones, side + "HandIndex1");
  const p = wpos(bones, side + "HandPinky1");
  return i.sub(w).cross(p.sub(w)).normalize();
}

// spreadSign (как в источнике): +поворот указательного вокруг нормали ладони
// должен УДАЛЯТЬ его кончик от среднего.
function spreadSign(side, pn) {
  const mcp = wpos(bones, side + "HandIndex1");
  const tip = wpos(bones, side + "HandIndex4");
  const ref = wpos(bones, side + "HandMiddle4");
  const dist = (deg) => tip.clone().sub(mcp).applyAxisAngle(pn, (deg * Math.PI) / 180).add(mcp).distanceTo(ref);
  return dist(12) > dist(-12) ? 1 : -1;
}

const pn = palmNormal("Right");
const sign = spreadSign("Right", pn);
const ref = wpos(bones, "RightHandMiddle4");

const RAW = 20; // положительный spread в позе = «растопырить»
let failed = false;

for (const f of ["Index", "Ring", "Pinky"]) {
  const mcp = wpos(bones, `RightHand${f}1`);
  const tip = wpos(bones, `RightHand${f}4`);
  const rest = tip.distanceTo(ref);

  // φ драйвера для правой кисти = side(+1)·SPREAD_DIR·raw (см. humanoid.applyArm).
  const phi = (1 * SPREAD_DIR[f] * RAW * Math.PI) / 180;
  // Рантайм: поворот MCP вокруг нормали ладони на spreadSign·φ.
  const moved = tip.clone().sub(mcp).applyAxisAngle(pn, sign * phi).add(mcp);
  const after = moved.distanceTo(ref);

  const fanned = after > rest + 1e-4;
  console.log(`${fanned ? "ok" : "FAIL"} ${f}: dist ${rest.toFixed(4)} → ${after.toFixed(4)} (φ=${(SPREAD_DIR[f] * RAW).toFixed(0)}°)`);
  if (!fanned) failed = true;
}

// Отрицательный spread (скрещивание, как в Р/ASL R) — палец идёт К среднему.
{
  const mcp = wpos(bones, "RightHandIndex1");
  const tip = wpos(bones, "RightHandIndex4");
  const rest = tip.distanceTo(ref);
  const phi = (1 * SPREAD_DIR.Index * -9 * Math.PI) / 180; // spread −9 (крест)
  const moved = tip.clone().sub(mcp).applyAxisAngle(pn, sign * phi).add(mcp);
  const after = moved.distanceTo(ref);
  const crossed = after < rest - 1e-4;
  console.log(`${crossed ? "ok" : "FAIL"} Index(−9° крест): dist ${rest.toFixed(4)} → ${after.toFixed(4)}`);
  if (!crossed) failed = true;
}

console.log(`\nspreadSign=${sign}  ${failed ? "— ПРОВАЛ" : "— разведение веером: OK"}`);
process.exit(failed ? 1 : 0);
