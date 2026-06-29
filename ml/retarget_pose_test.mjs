// Офлайн-проверка математики живого ретаргета (frontend-react/src/avatar3d/
// poseRetarget.ts) — TS-двойник ml/extract_pose_clip.py --self-test.
//
// Импортирует .ts напрямую: Node ≥23.6 стрипает типы (poseRetarget.ts
// использует только erasable-синтаксис). Запуск:  node ml/retarget_pose_test.mjs
//
// Проверяет, что порт согласован с контрактом поз на эталонных скелетах: рука
// висит/вперёд/в Т-позе/локоть 90°, супинация/пронация по ладонной нормали,
// раскрытая кисть → нулевые сгибы, кулак → большой сгиб, прореживание кадров.

import {
  makeTorso,
  retargetArm,
  retargetHand,
  palmNormal,
  thinKeyframes,
} from "../frontend-react/src/avatar3d/poseRetarget.ts";

let fails = 0;
const ok = (cond, msg) => {
  if (cond) {
    console.log("ok  ", msg);
  } else {
    console.log("FAIL", msg);
    fails++;
  }
};

const P_NOSE = 0, P_LEAR = 7, P_REAR = 8;
const P_RSH = 12, P_REL = 14, P_RWR = 16, P_LSH = 11, P_LHIP = 23, P_RHIP = 24;

const basePl = () => {
  const pl = Array.from({ length: 33 }, () => [0, 0, 0]);
  pl[P_LSH] = [-0.2, 0.5, 0];
  pl[P_RSH] = [0.2, 0.5, 0];
  pl[P_LHIP] = [-0.15, 0.0, 0];
  pl[P_RHIP] = [0.15, 0.0, 0];
  pl[P_NOSE] = [0, 0.62, 0.1];
  pl[P_LEAR] = [-0.07, 0.6, 0];
  pl[P_REAR] = [0.07, 0.6, 0];
  return pl;
};
const vis = new Array(33).fill(1);

function arm(sh, el, wr, palm = null) {
  const p = basePl();
  p[P_RSH] = sh;
  p[P_REL] = el;
  p[P_RWR] = wr;
  return retargetArm("r", p, vis, makeTorso(p), palm);
}

// ── Рука: плечо / локоть / предплечье ────────────────────────────────────────
let a = arm([0.2, 0.5, 0], [0.2, 0.2, 0], [0.2, -0.1, 0]); // висит
ok(Math.abs(a.sh[0]) < 3 && Math.abs(a.sh[1]) < 3 && a.el < 3, `hang: ${JSON.stringify(a)}`);

a = arm([0.2, 0.5, 0], [0.2, 0.5, 0.3], [0.2, 0.5, 0.6]); // вперёд
ok(Math.abs(a.sh[0] - 90) < 3 && a.el < 3, `forward raise≈90: ${JSON.stringify(a)}`);

a = arm([0.2, 0.5, 0], [0.5, 0.5, 0], [0.8, 0.5, 0]); // Т-поза
ok(Math.abs(a.sh[1] - 90) < 3, `T-pose side≈90: ${JSON.stringify(a)}`);

a = arm([0.2, 0.5, 0], [0.2, 0.2, 0], [0.2, 0.2, 0.3]); // локоть 90°
ok(Math.abs(a.el - 90) < 3 && Math.abs(a.sh[2]) < 5, `elbow≈90: ${JSON.stringify(a)}`);

a = arm([0.2, 0.5, 0], [0.2, 0.2, 0], [0.2, 0.2, 0.3], [0, 1, 0]); // супинация
ok(a.tw > 80 && a.tw < 100, `supination tw≈+90: ${JSON.stringify(a)}`);

a = arm([0.2, 0.5, 0], [0.2, 0.2, 0], [0.2, 0.2, 0.3], [0, -1, 0]); // пронация
ok(a.tw > -100 && a.tw < -80, `pronation tw≈-90: ${JSON.stringify(a)}`);

// ── Кисть: ладонь к камере, пальцы вверх (пиксельные коорд., y вниз) ──────────
const hl = Array.from({ length: 21 }, () => [0, 0, 0]);
hl[0] = [500, 800, 0];
const FX = { index: 560, middle: 520, ring: 480, pinky: 440 };
const FI = { index: [5, 6, 7, 8], middle: [9, 10, 11, 12], ring: [13, 14, 15, 16], pinky: [17, 18, 19, 20] };
for (const name of Object.keys(FI)) {
  const [mcp, pip, dip, tip] = FI[name];
  const x = FX[name];
  hl[mcp] = [x, 500, 0];
  hl[pip] = [x, 420, 0];
  hl[dip] = [x, 360, 0];
  hl[tip] = [x, 310, 0];
}
hl[1] = [580, 760, 0];
hl[2] = [640, 700, 0];
hl[3] = [680, 660, 0];
hl[4] = [710, 630, 0];

const n = palmNormal("r", hl);
ok(n[2] < -0.9, `palm normal toward camera: ${JSON.stringify(n.map((v) => +v.toFixed(2)))}`);

const { hand, wr } = retargetHand("r", hl, [0, -1, 0]); // предплечье вверх
ok(
  ["index", "middle", "ring", "pinky"].every((f) => Math.max(...hand[f].curl) < 12),
  `open hand → near-zero curls: ${JSON.stringify(hand.index.curl)}`,
);
ok(Math.abs(wr[0]) < 12 && Math.abs(wr[1]) < 12, `straight wrist: ${JSON.stringify(wr)}`);

const hl2 = hl.map((v) => [...v]);
hl2[7] = [560, 420, 60];
hl2[8] = [560, 420, 110]; // согнуть указательный в PIP
const { hand: hand2 } = retargetHand("r", hl2, null);
ok(hand2.index.curl[1] > 75, `bent index PIP: ${JSON.stringify(hand2.index.curl)}`);

// ── Прореживание ключевых кадров ─────────────────────────────────────────────
const fr = Array.from({ length: 10 }, (_, i) => ({
  t: i * 66,
  pose: { rArm: { el: 10 + Math.floor(i / 5) * 30 } },
}));
const thin = thinKeyframes(fr, 4.0);
ok(
  thin[0].t === 0 && thin.at(-1).t === fr.at(-1).t && thin.length < fr.length,
  `thinning keeps ends, drops middle: ${thin.length}/${fr.length}`,
);

if (fails) {
  console.log(`\n${fails} FAILED`);
  process.exit(1);
}
console.log("\nself-test: OK — TS-ретаргет согласован с контрактом поз");
