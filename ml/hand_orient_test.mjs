// Оффлайн-проверка ориентации кисти (frontend-react/src/avatar3d/handOrient.ts).
// Кормим синтетическую кисть с ИЗВЕСТНОЙ ориентацией и печатаем, куда реально
// смотрят пальцы/ладонь/большой палец у аватара в мире. Браузер не нужен —
// проверяем математику и конвенции детерминированно. node ml/hand_orient_test.mjs
//
// Пространство pts (как получает solveHandWorld): x вправо, y ВНИЗ, z — меньше =
// ближе к камере (изотропные пиксели [x·W, y·H, z·W]).

import * as THREE from "../frontend-react/node_modules/three/build/three.module.js";
import { solveHandWorld } from "../frontend-react/src/avatar3d/handOrient.ts";

const r3 = (v) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
const dirName = (v) => {
  // ближайшая мировая ось словами (мир аватара: +X экран-право, +Y вверх, +Z к камере)
  const ax = [
    ["+X (экран-право)", new THREE.Vector3(1, 0, 0)],
    ["-X (экран-лево)", new THREE.Vector3(-1, 0, 0)],
    ["+Y (вверх)", new THREE.Vector3(0, 1, 0)],
    ["-Y (вниз)", new THREE.Vector3(0, -1, 0)],
    ["+Z (к камере)", new THREE.Vector3(0, 0, 1)],
    ["-Z (от камеры)", new THREE.Vector3(0, 0, -1)],
  ];
  let best = ax[0];
  for (const a of ax) if (v.dot(a[1]) > v.dot(best[1])) best = a;
  return best[0];
};

function emptyHand() {
  return Array.from({ length: 21 }, () => [0, 0, 0]);
}

// Меш-оси аватара (humanoid buildHand): большой палец +X·side, пальцы −Y, ладонь +Z.
// solveHandWorld возвращает wrDev = handMesh·Ry(−side·90): handMesh = q·Ry(side·90).
function meshDirs(side, hl) {
  const qq = solveHandWorld(hl, side);
  const q = new THREE.Quaternion(qq.x, qq.y, qq.z, qq.w);
  const s = side === "r" ? 1 : -1;
  const ry = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s * Math.PI / 2);
  const mesh = q.clone().multiply(ry);
  return {
    q,
    thumb: new THREE.Vector3(s, 0, 0).applyQuaternion(mesh),
    fingers: new THREE.Vector3(0, -1, 0).applyQuaternion(mesh),
    palm: new THREE.Vector3(0, 0, 1).applyQuaternion(mesh),
  };
}

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? "ok  " : "FAIL", msg); if (!cond) fails++; };

// ── Синтетическая ПРАВАЯ кисть: ладонь к камере, пальцы вверх ────────────────
// pts: y вниз → пальцы вверх = middle.y < wrist.y. Большой палец у правой кисти
// (палм к камере, пальцы вверх) анатомически у пользователя слева → в СЫРОМ кадре
// (не зеркаленном) справа = +x; index рядом с большим (+x), pinky (−x).
const rightHand = emptyHand();
rightHand[0] = [0, 100, 0];   // wrist
rightHand[9] = [0, 0, 0];     // middle_mcp (выше)
rightHand[5] = [30, 20, 0];   // index_mcp (+x, сторона большого)
rightHand[17] = [-30, 20, 0]; // pinky_mcp (−x)

console.log("=== ПРАВАЯ кисть пользователя: ладонь к камере, пальцы вверх ===");
for (const side of ["r", "l"]) {
  const d = meshDirs(side, rightHand);
  console.log(`  как '${side}': пальцы ${dirName(d.fingers)} | ладонь ${dirName(d.palm)} | большой ${dirName(d.thumb)}`);
  console.log(`         векторы: fingers ${r3(d.fingers)} palm ${r3(d.palm)} thumb ${r3(d.thumb)}`);
}

// ── Инварианты математики (должны держаться независимо от конвенции) ─────────
{
  const d = meshDirs("r", rightHand);
  // Ортонормированность/правша: |dirs|=1 и thumb×... det=+1 (не вывернута).
  const len = (v) => Math.abs(v.length() - 1) < 1e-3;
  ok(len(d.thumb) && len(d.fingers) && len(d.palm), "оси единичные (ортонормированный базис)");
  const fingersUp = new THREE.Vector3(0, -1, 0).applyQuaternion(
    new THREE.Quaternion(d.q.x, d.q.y, d.q.z, d.q.w).multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
    ),
  );
  ok(fingersUp.y > 0.7, "пальцы смотрят ВВЕРХ (как у пользователя)");
  ok(d.palm.z > 0.7, "ладонь смотрит К КАМЕРЕ (+Z)");
  // det правши: thumb·(fingers×palm) ≈ +1 → не зеркальная (не вывернутая) кисть.
  const det = d.thumb.dot(new THREE.Vector3().crossVectors(d.fingers, d.palm));
  console.log(`  det(thumb,fingers,palm) = ${det.toFixed(3)} (правша ≈ −1 при mesh −Y пальцы)`);
}

// ── Стабильность: малый поворот кисти → малое изменение (нет «плавания») ─────
{
  const tilt = emptyHand();
  const rot = (p) => {
    const a = 0.25; // ~14° наклон в плоскости кадра
    return [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2]];
  };
  for (let i = 0; i < 21; i++) tilt[i] = rot(rightHand[i]);
  const a = meshDirs("r", rightHand).palm;
  const b = meshDirs("r", tilt).palm;
  const drift = a.angleTo(b) * 180 / Math.PI;
  console.log(`  наклон кисти на 14° → сдвиг нормали ладони ${drift.toFixed(1)}° (должно быть ~мало, без скачка)`);
  ok(drift < 40, "нет «плавания»: нормаль ладони меняется плавно");
}

console.log(fails ? `\nПРОВАЛ (${fails})` : "\nматематика ориентации кисти: OK");
process.exit(fails ? 1 : 0);
