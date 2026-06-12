// Процедурный гуманоид собственного аватара SoundSight.
//
// Никаких внешних моделей и скриптов: вся геометрия строится кодом из
// примитивов three.js, скелет — иерархия THREE.Group. Полная артикуляция
// для жестового языка: плечо (3 DOF), локоть, вращение предплечья, кисть
// (2 DOF), по 4 пальца с тремя фалангами и большой палец (spread/oppose/curl)
// на каждой руке, шея/голова, корпус.
//
// Канальная семантика (градусы, анатомическая, см. poseTypes.ts) переводится
// здесь в повороты конкретных групп; знаки для левой/правой стороны
// зеркалируются автоматически — позы пишутся один раз.

import * as THREE from "three";
import type { Channels } from "./poseTypes";

const DEG = Math.PI / 180;

// Палитра — согласована с темой приложения (indigo-акцент).
const SKIN = 0xe8b9a0;
const SKIN_DARK = 0xd9a288;
const SHIRT = 0x4f46e5;
const SHIRT_DARK = 0x3f38c9;
const HAIR = 0x3a3340;
const EYE = 0x2b2731;

function mat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02 });
}

/** Капсула-«кость» от узла вдоль −Y длиной len. */
function limb(len: number, r: number, material: THREE.Material): THREE.Mesh {
  const cyl = Math.max(0.001, len - 2 * r);
  const g = new THREE.CapsuleGeometry(r, cyl, 6, 14);
  const m = new THREE.Mesh(g, material);
  m.position.y = -len / 2;
  return m;
}

interface FingerJoints {
  spread: THREE.Group;
  curls: [THREE.Group, THREE.Group, THREE.Group];
}

interface ThumbJoints {
  spread: THREE.Group;
  oppose: THREE.Group;
  curls: [THREE.Group, THREE.Group];
}

interface HandRig {
  fingers: Record<"index" | "middle" | "ring" | "pinky", FingerJoints>;
  thumb: ThumbJoints;
}

interface ArmRig {
  shSide: THREE.Group; // абдукция (Z)
  shRaise: THREE.Group; // подъём вперёд (X)
  shRot: THREE.Group; // осевое (Y)
  elbow: THREE.Group; // сгиб (X)
  twist: THREE.Group; // пронация/супинация (Y)
  wrFlex: THREE.Group; // сгиб кисти (Z)
  wrDev: THREE.Group; // девиация (X)
  hand: HandRig;
}

const FINGER_X = { index: 0.03, middle: 0.01, ring: -0.01, pinky: -0.03 } as const;
const FINGER_LEN = {
  index: [0.04, 0.027, 0.021],
  middle: [0.044, 0.029, 0.022],
  ring: [0.04, 0.027, 0.021],
  pinky: [0.031, 0.021, 0.017],
} as const;
const FINGER_R = { index: 0.0085, middle: 0.0088, ring: 0.0082, pinky: 0.0074 } as const;
// Куда «растопыривается» палец относительно среднего (множитель к spread).
const SPREAD_DIR = { index: 1, middle: 0.3, ring: -0.7, pinky: -1 } as const;

function buildFinger(
  name: keyof typeof FINGER_X,
  skin: THREE.Material,
  side: 1 | -1,
): { root: THREE.Group; joints: FingerJoints } {
  const lens = FINGER_LEN[name];
  const r = FINGER_R[name];

  const root = new THREE.Group();
  root.position.set(side * FINGER_X[name], -0.087, 0);

  const spread = new THREE.Group();
  root.add(spread);

  const curls: THREE.Group[] = [];
  let parent: THREE.Group = spread;
  for (let i = 0; i < 3; i++) {
    const j = new THREE.Group();
    if (i > 0) j.position.y = -lens[i - 1];
    parent.add(j);
    j.add(limb(lens[i], r * (1 - i * 0.08), skin));
    curls.push(j);
    parent = j;
  }
  return { root, joints: { spread, curls: curls as FingerJoints["curls"] } };
}

function buildHand(side: 1 | -1, skin: THREE.Material): { root: THREE.Group; rig: HandRig } {
  // Локальная система кисти: пальцы вдоль −Y, ладонная сторона +Z,
  // большой палец со стороны side*+X (правая: +X, левая: −X).
  const root = new THREE.Group();

  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.092, 0.026), skin);
  palm.position.y = -0.046;
  (palm.geometry as THREE.BoxGeometry).translate(0, 0, 0);
  root.add(palm);

  const fingers = {} as HandRig["fingers"];
  (Object.keys(FINGER_X) as (keyof typeof FINGER_X)[]).forEach((name) => {
    const { root: fr, joints } = buildFinger(name, skin, side);
    root.add(fr);
    fingers[name] = joints;
  });

  // Большой палец: корень у основания ладони, преднаклон в сторону.
  const tRoot = new THREE.Group();
  tRoot.position.set(side * 0.046, -0.022, 0.006);
  root.add(tRoot);

  const pre = new THREE.Group();
  pre.rotation.z = side * 58 * DEG; // от «вниз» к «вбок»
  pre.rotation.x = -14 * DEG; // слегка перед плоскостью ладони
  tRoot.add(pre);

  const tSpread = new THREE.Group();
  pre.add(tSpread);
  const tOppose = new THREE.Group();
  tSpread.add(tOppose);

  const tl: [number, number] = [0.038, 0.03];
  const tCurls: THREE.Group[] = [];
  let parent: THREE.Group = tOppose;
  for (let i = 0; i < 2; i++) {
    const j = new THREE.Group();
    if (i > 0) j.position.y = -tl[i - 1];
    parent.add(j);
    j.add(limb(tl[i], 0.0105 - i * 0.001, skin));
    tCurls.push(j);
    parent = j;
  }

  return {
    root,
    rig: {
      fingers,
      thumb: { spread: tSpread, oppose: tOppose, curls: tCurls as ThumbJoints["curls"] },
    },
  };
}

function buildArm(side: 1 | -1, skin: THREE.Material, shirt: THREE.Material): {
  root: THREE.Group;
  rig: ArmRig;
} {
  // side: +1 = правая рука персонажа (мировой −X… знак уже учтён позицией
  // плеча в buildBody; внутри руки side задаёт только зеркальные знаки).
  const root = new THREE.Group();

  const shSide = new THREE.Group();
  const shRaise = new THREE.Group();
  const shRot = new THREE.Group();
  root.add(shSide);
  shSide.add(shRaise);
  shRaise.add(shRot);

  // Плечевой «погон» + плечевая кость.
  const pad = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 12), shirt);
  shRot.add(pad);
  shRot.add(limb(0.27, 0.04, shirt));

  const elbow = new THREE.Group();
  elbow.position.y = -0.27;
  shRot.add(elbow);

  const twist = new THREE.Group();
  elbow.add(twist);
  twist.add(limb(0.25, 0.034, skin));

  const wrFlex = new THREE.Group();
  wrFlex.position.y = -0.25;
  twist.add(wrFlex);
  const wrDev = new THREE.Group();
  wrFlex.add(wrDev);

  // Кисть: преднастройка так, чтобы в покое (рука вниз, tw=0) ладонь
  // смотрела на тело. Локальная нормаль ладони +Z → поворот вокруг Y.
  const { root: handRoot, rig: handRig } = buildHand(side, skin);
  const handBase = new THREE.Group();
  handBase.rotation.y = side * 90 * DEG;
  handBase.add(handRoot);
  wrDev.add(handBase);

  return {
    root,
    rig: { shSide, shRaise, shRot, elbow, twist, wrFlex, wrDev, hand: handRig },
  };
}

export class Humanoid {
  readonly root = new THREE.Group();

  private spineJ: [THREE.Group, THREE.Group, THREE.Group];
  private headJ: [THREE.Group, THREE.Group, THREE.Group];
  private arms: { r: ArmRig; l: ArmRig };

  constructor() {
    const skin = mat(SKIN);
    const skinD = mat(SKIN_DARK);
    const shirt = mat(SHIRT);
    const shirtD = mat(SHIRT_DARK);
    const hair = mat(HAIR);
    const eye = mat(EYE);

    // ── Корпус ───────────────────────────────────────────────────────────
    const hips = new THREE.Group();
    hips.position.y = 0.92;
    this.root.add(hips);

    const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.135, 0.05, 6, 16), shirtD);
    pelvis.scale.z = 0.7;
    hips.add(pelvis);

    const sBend = new THREE.Group();
    const sTurn = new THREE.Group();
    const sTilt = new THREE.Group();
    hips.add(sBend);
    sBend.add(sTurn);
    sTurn.add(sTilt);
    this.spineJ = [sBend, sTurn, sTilt];

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.155, 0.3, 8, 18), shirt);
    torso.scale.z = 0.62;
    torso.position.y = 0.26;
    sTilt.add(torso);

    const chest = new THREE.Group();
    chest.position.y = 0.44;
    sTilt.add(chest);

    // ── Голова ───────────────────────────────────────────────────────────
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.09, 12), skinD);
    neck.position.y = 0.045;
    chest.add(neck);

    const hNod = new THREE.Group();
    const hTurn = new THREE.Group();
    const hTilt = new THREE.Group();
    hNod.position.y = 0.09;
    chest.add(hNod);
    hNod.add(hTurn);
    hTurn.add(hTilt);
    this.headJ = [hNod, hTurn, hTilt];

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 20), skin);
    head.position.y = 0.105;
    hTilt.add(head);

    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.109, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.52),
      hair,
    );
    cap.position.y = 0.115;
    cap.rotation.x = -0.35;
    hTilt.add(cap);

    for (const ex of [-0.038, 0.038]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.0105, 10, 8), eye);
      e.position.set(ex, 0.115, 0.092);
      hTilt.add(e);
    }
    const mouth = new THREE.Mesh(new THREE.CapsuleGeometry(0.006, 0.028, 4, 8), mat(0xb9776a));
    mouth.rotation.z = Math.PI / 2;
    mouth.position.set(0, 0.055, 0.096);
    hTilt.add(mouth);

    // ── Руки ─────────────────────────────────────────────────────────────
    // Аватар смотрит на камеру (+Z) → его правая сторона = мировой −X,
    // то есть для зрителя правая рука аватара слева — как у живого
    // сурдопереводчика напротив.
    const armR = buildArm(1, skin, shirt);
    armR.root.position.set(-0.19, 0.39, 0);
    chest.add(armR.root);

    const armL = buildArm(-1, skin, shirt);
    armL.root.position.set(0.19, 0.39, 0);
    chest.add(armL.root);

    this.arms = { r: armR.rig, l: armL.rig };

    // Ноги — статичные (аватар по пояс в кадре, но пусть будут для общих планов).
    for (const lx of [-0.085, 0.085]) {
      const leg = limb(0.85, 0.055, shirtD);
      leg.position.set(lx, -0.43, 0);
      hips.add(leg);
    }
  }

  /**
   * Суставы-группы под «чистыми» именами костей Mixamo — для использования
   * этого гуманоида как невидимого драйвер-скелета при ретаргете на скиновую
   * модель (см. skinnedHumanoid.ts). Возвращаются именно те узлы, мировая
   * ориентация которых соответствует одноимённой кости Mixamo:
   *   {Side}Arm      → плечо после всех 3 DOF (ориентация плечевой кости)
   *   {Side}ForeArm  → после локтя+супинации (ориентация предплечья)
   *   {Side}Hand     → после сгиба/девиации кисти
   *   {Side}Hand{Finger}{1..3} → три фаланги пальца
   *   Spine2, Head   → верх корпуса и голова (остальные кости остаются в rest)
   */
  driverSegments(): Record<string, THREE.Object3D> {
    const out: Record<string, THREE.Object3D> = {};
    const addArm = (side: "Right" | "Left", rig: ArmRig): void => {
      out[`${side}Arm`] = rig.shRot;
      out[`${side}ForeArm`] = rig.twist;
      out[`${side}Hand`] = rig.wrDev;
      const finger = (name: string, j: FingerJoints): void => {
        out[`${side}Hand${name}1`] = j.curls[0];
        out[`${side}Hand${name}2`] = j.curls[1];
        out[`${side}Hand${name}3`] = j.curls[2];
      };
      finger("Index", rig.hand.fingers.index);
      finger("Middle", rig.hand.fingers.middle);
      finger("Ring", rig.hand.fingers.ring);
      finger("Pinky", rig.hand.fingers.pinky);
      out[`${side}HandThumb1`] = rig.hand.thumb.oppose;
      out[`${side}HandThumb2`] = rig.hand.thumb.curls[0];
      out[`${side}HandThumb3`] = rig.hand.thumb.curls[1];
    };
    addArm("Right", this.arms.r);
    addArm("Left", this.arms.l);
    out["Spine2"] = this.spineJ[2];
    out["Head"] = this.headJ[2];
    return out;
  }

  /**
   * Применить ПОЛНЫЙ канальный срез (player резолвит частичность сам).
   * Здесь — только перевод анатомических каналов в повороты групп.
   */
  applyChannels(ch: Channels): void {
    this.applyArm("rArm", "rHand", this.arms.r, 1, ch);
    this.applyArm("lArm", "lHand", this.arms.l, -1, ch);

    const g = (k: string) => (ch[k] ?? 0) * DEG;
    this.headJ[0].rotation.x = g("head0");
    this.headJ[1].rotation.y = g("head1");
    this.headJ[2].rotation.z = g("head2");
    this.spineJ[0].rotation.x = g("spine0");
    this.spineJ[1].rotation.y = g("spine1");
    this.spineJ[2].rotation.z = g("spine2");
  }

  private applyArm(ap: string, hp: string, rig: ArmRig, side: 1 | -1, ch: Channels): void {
    const v = (k: string) => ch[`${ap}.${k}`] ?? 0;
    const h = (k: string) => ch[`${hp}.${k}`] ?? 0;

    // Геометрия построена «рука вдоль −Y»; выводы знаков — см. комментарии:
    //   подъём вперёд  = поворот X на −raise (−Y → +Z)
    //   абдукция       = поворот Z: правой (side=+1, мировой −X) — на −side·rad
    //   осевое наружу  = поворот Y на −side·rot
    rig.shRaise.rotation.x = -v("sh0") * DEG;
    rig.shSide.rotation.z = -side * v("sh1") * DEG;
    rig.shRot.rotation.y = -side * v("sh2") * DEG;

    rig.elbow.rotation.x = -v("el") * DEG;

    // Супинация(+): ладонь из нейтрали (к телу) разворачивается вперёд/вверх.
    rig.twist.rotation.y = -side * v("tw") * DEG;

    // Сгиб кисти к ладони: ладонная сторона в системе предплечья = side·(+X).
    rig.wrFlex.rotation.z = side * v("wr0") * DEG;
    // Девиация к большому пальцу (в покое он смотрит вперёд, +Z) = поворот X на −dev.
    rig.wrDev.rotation.x = -v("wr1") * DEG;

    // Пальцы: сгиб к ладони (+Z локально) = −rotation.x; spread — вокруг Z.
    (Object.keys(FINGER_X) as (keyof typeof FINGER_X)[]).forEach((name) => {
      const f = rig.hand.fingers[name];
      f.spread.rotation.z = side * SPREAD_DIR[name] * h(`${name}.spread`) * DEG;
      f.curls[0].rotation.x = -h(`${name}.c0`) * DEG;
      f.curls[1].rotation.x = -h(`${name}.c1`) * DEG;
      f.curls[2].rotation.x = -h(`${name}.c2`) * DEG;
    });

    const t = rig.hand.thumb;
    t.spread.rotation.z = side * h("thumb.spread") * DEG;
    t.oppose.rotation.y = -side * h("thumb.oppose") * DEG;
    t.curls[0].rotation.x = -h("thumb.c0") * DEG;
    t.curls[1].rotation.x = -h("thumb.c1") * DEG;
  }
}
