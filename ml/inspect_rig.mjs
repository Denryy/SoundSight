// Инспектор скелета скиновой модели (Mixamo glTF/GLB) — БЕЗ зависимостей.
//
// Зачем: ретаргет в skinnedHumanoid.ts корректен только если драйвер в позе
// MIXAMO_BIND физически совпадает с REST-позой модели. При смене модели
// (например, connor.glb → RK900) старый зашитый MIXAMO_BIND протухает и кисти
// «ломаются». Этот скрипт читает rest-скелет прямо из GLB и считает реальные
// анатомические углы плеча/локтя + покой пальцев, чтобы пересчитать bind.
//
//   node ml/inspect_rig.mjs [path-to.glb]
//
// GLB = 12-байтный заголовок + чанки (JSON, BIN). Rest-поза — это локальные
// TRS узлов в JSON-чанке; костей-«суставов» список в skins[].joints. Текстуры/
// геометрию не трогаем — нужен только скелет.

import fs from "node:fs";

const path = process.argv[2] || "frontend-react/public/models/connor.glb";

// ── BONE_MAP / bind из mixamoRig.ts (держать синхронно) ─────────────────────
const ARM_BONES = ["Arm", "ForeArm", "Hand"];
const FINGERS = ["Thumb", "Index", "Middle", "Ring", "Pinky"];
const CURRENT_BIND = { rArm: { sh: [0, 44, 0], el: 13 }, lArm: { sh: [0, 44, 0], el: 13 } };
const BONE_MAP_NAMES = ["Spine2", "Head"];
for (const side of ["Right", "Left"]) {
  for (const b of ARM_BONES) BONE_MAP_NAMES.push(side + b);
  for (const f of FINGERS) for (let i = 1; i <= 3; i++) {
    if (f === "Thumb" && i > 3) continue;
    BONE_MAP_NAMES.push(`${side}Hand${f}${i}`);
  }
}

// ── мини-математика (column-major 4x4, как в glTF/three) ─────────────────────
const compose = (t, q, s) => {
  const [x, y, z, w] = q, [sx, sy, sz] = s;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0], t[1], t[2], 1,
  ];
};
const mul = (a, b) => {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
};
const pos = (m) => [m[12], m[13], m[14]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]) || 1;
const norm = (v) => { const l = len(v); return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const deg = (r) => (r * 180) / Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = (x) => Math.round(x * 10) / 10;

// ── разбор GLB ───────────────────────────────────────────────────────────────
const buf = fs.readFileSync(path);
if (buf.readUInt32LE(0) !== 0x46546c67) { console.error("не GLB:", path); process.exit(1); }
const version = buf.readUInt32LE(4);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen));
const nodes = json.nodes || [];

// корни = узлы, не встречающиеся как чей-либо ребёнок
const isChild = new Set();
nodes.forEach((n) => (n.children || []).forEach((c) => isChild.add(c)));
const roots = nodes.map((_, i) => i).filter((i) => !isChild.has(i));

const world = new Array(nodes.length);
const dfs = (i, parentM) => {
  const n = nodes[i];
  const local = compose(n.translation || [0, 0, 0], n.rotation || [0, 0, 0, 1], n.scale || [1, 1, 1]);
  world[i] = parentM ? mul(parentM, local) : local;
  (n.children || []).forEach((c) => dfs(c, world[i]));
};
roots.forEach((r) => dfs(r, null));

// кости = joints всех skins
const boneIdx = new Set();
(json.skins || []).forEach((sk) => (sk.joints || []).forEach((j) => boneIdx.add(j)));

const cleanRe = /^mixamorig[:_]?(.+?)(_\d+)?$/i;
const clean = (raw) => { const m = cleanRe.exec(raw || ""); return m ? m[1] : raw; };
const byClean = new Map();
[...boneIdx].forEach((i) => { const c = clean(nodes[i].name); if (!byClean.has(c)) byClean.set(c, i); });

// ── отчёт ────────────────────────────────────────────────────────────────────
console.log(`\n=== ${path} ===`);
console.log(`GLB v${version} | узлов: ${nodes.length} | костей(joints): ${boneIdx.size}`);
const sample = [...boneIdx].slice(0, 4).map((i) => nodes[i].name);
console.log(`пример имён костей: ${sample.join(", ")}`);
console.log(`mixamorig-префикс: ${sample.some((n) => /mixamorig/i.test(n)) ? "ДА" : "НЕТ ⚠"}`);

const missing = BONE_MAP_NAMES.filter((b) => !byClean.has(b));
console.log(`\nBONE_MAP: ${BONE_MAP_NAMES.length - missing.length}/${BONE_MAP_NAMES.length} найдено`);
if (missing.length) console.log(`  ⚠ НЕ найдены: ${missing.join(", ")}`);

// углы плеча/локтя из rest-направлений костей
console.log(`\n── Плечо/локоть в REST (модель) vs текущий MIXAMO_BIND ──`);
const suggest = {};
for (const [side, sign, key] of [["Right", +1, "rArm"], ["Left", -1, "lArm"]]) {
  const iA = byClean.get(side + "Arm"), iF = byClean.get(side + "ForeArm"), iH = byClean.get(side + "Hand");
  if (iA == null || iF == null || iH == null) { console.log(`  ${side}: кости руки не найдены`); continue; }
  const pA = pos(world[iA]), pF = pos(world[iF]), pH = pos(world[iH]);
  const uA = norm(sub(pF, pA)); // плечевая кость
  const fA = norm(sub(pH, pF)); // предплечье
  // драйвер: dir = (-sign·sin s, -cos s·cos r, cos s·sin r); инвертируем:
  const flat = Math.hypot(uA[1], uA[2]);
  const sideDeg = deg(Math.atan2(Math.abs(uA[0]), flat));
  const raiseDeg = deg(Math.atan2(uA[2], -uA[1]));
  const elbowDeg = deg(Math.acos(clamp(dot(uA, fA), -1, 1)));
  const cur = CURRENT_BIND[key];
  console.log(`  ${side}: raise=${r1(raiseDeg)} side=${r1(sideDeg)} elbow=${r1(elbowDeg)}   ` +
    `(bind сейчас: raise=${cur.sh[0]} side=${cur.sh[1]} el=${cur.el})  ` +
    `Δ=[${r1(raiseDeg - cur.sh[0])}, ${r1(sideDeg - cur.sh[1])}, ${r1(elbowDeg - cur.el)}]`);
  console.log(`      uArmDir=[${uA.map(r1)}]`);
  suggest[key] = { sh: [r1(raiseDeg), r1(sideDeg), 0], el: r1(elbowDeg) };
}

// покой пальцев: угол сгиба на каждом суставе (0 = прямой).
// Для сустава Jk берём угол между входящим (J(k-1)→Jk) и исходящим (Jk→J(k+1))
// сегментами — это и есть локальный «curl» сустава, независимо от roll кости.
// Чисто измеримы средний (c1/PIP) и дистальный (c2/DIP); проксимальный (c0/MCP)
// относительно ладони шумит из-за свода ладони — берём ≈ c1.
console.log(`\n── Покой пальцев по суставам (угол; ~0 = прямой) ──`);
let curledFlag = false;
const handBind = {}; // side → { finger: [c0,c1,c2], thumb:[c0,c1] }
const bendAt = (a, b, c) => {
  if (a == null || b == null || c == null) return null;
  const d1 = norm(sub(pos(world[b]), pos(world[a])));
  const d2 = norm(sub(pos(world[c]), pos(world[b])));
  return deg(Math.acos(clamp(dot(d1, d2), -1, 1)));
};
for (const side of ["Right", "Left"]) {
  const parts = [];
  const fingers = {};
  for (const f of ["Index", "Middle", "Ring", "Pinky"]) {
    const h = byClean.get(`${side}Hand`);
    const j1 = byClean.get(`${side}Hand${f}1`), j2 = byClean.get(`${side}Hand${f}2`),
          j3 = byClean.get(`${side}Hand${f}3`), j4 = byClean.get(`${side}Hand${f}4`);
    const pip = bendAt(j1, j2, j3);          // c1
    const dip = bendAt(j2, j3, j4);          // c2
    if (pip == null) { parts.push(`${f}:?`); continue; }
    const c1 = r1(pip), c2 = r1(dip ?? pip * 0.7), c0 = c1; // MCP≈PIP
    if (Math.max(c0, c1, c2) > 12) curledFlag = true;
    fingers[f.toLowerCase()] = [c0, c1, c2];
    parts.push(`${f}:[${c0},${c1},${c2}]`);
  }
  // большой палец: суставы Thumb2 (c0) и Thumb3 (c1)
  const t1 = byClean.get(`${side}HandThumb1`), t2 = byClean.get(`${side}HandThumb2`),
        t3 = byClean.get(`${side}HandThumb3`), t4 = byClean.get(`${side}HandThumb4`);
  const tC0 = r1(bendAt(t1, t2, t3) ?? 0), tC1 = r1(bendAt(t2, t3, t4) ?? 0);
  parts.push(`Thumb:[${tC0},${tC1}]`);
  console.log(`  ${side}: ${parts.join("  ")}`);
  handBind[side] = { fingers, thumb: [tC0, tC1] };
}
if (curledFlag) console.log(`  ⚠ модель в rest НЕ с прямыми пальцами → bind ДОЛЖЕН включать эти curl`);

const handBlock = (side) => {
  const b = handBind[side];
  if (!b) return "  // ?";
  const fl = ["index", "middle", "ring", "pinky"]
    .filter((f) => b.fingers[f])
    .map((f) => `${f}: { curl: [${b.fingers[f].join(", ")}] }`);
  fl.push(`thumb: { curl: [${b.thumb.join(", ")}] }`);
  return `{ ${fl.join(", ")} }`;
};

console.log(`\n── Предлагаемый MIXAMO_BIND (для этой модели) ──`);
console.log(`export const MIXAMO_BIND: Pose = {`);
console.log(`  rArm: { sh: [${suggest.rArm?.sh.join(", ")}], el: ${suggest.rArm?.el} },`);
console.log(`  lArm: { sh: [${suggest.lArm?.sh.join(", ")}], el: ${suggest.lArm?.el} },`);
console.log(`  rHand: ${handBlock("Right")},`);
console.log(`  lHand: ${handBlock("Left")},`);
console.log(`};\n`);
