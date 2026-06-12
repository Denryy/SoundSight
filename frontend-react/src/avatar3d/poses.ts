// Библиотека поз собственного аватара: базовые стойки и дактильные алфавиты.
//
// ВАЖНО ПРО ТОЧНОСТЬ. Формы букв заданы вручную по контурам/описаниям и
// являются ПРИБЛИЖЕНИЕМ (помечено `≈`). Это стартовая точка: доводить формы
// нужно в экране «Аватар-лаб» (слайдеры → JSON → сюда), а ещё лучше — снять
// носителя ЖЯ на видео и извлечь позы скриптом ml/extract_pose_clip.py.
// Перед показом глухим пользователям формы ОБЯЗАТЕЛЬНО валидировать
// с носителями жестового языка.
//
// Семантика углов — см. poseTypes.ts (градусы, анатомические оси).

import type { ArmPose, HandPose, LetterDef, Pose } from "./poseTypes";

// ── Базовые стойки ───────────────────────────────────────────────────────────

/** Поза покоя: руки расслабленно вдоль тела. ПОЛНАЯ (задаёт все каналы). */
export const REST: Pose = {
  rArm: { sh: [8, 7, 0], el: 14, tw: 0, wr: [0, 0] },
  lArm: { sh: [8, 7, 0], el: 14, tw: 0, wr: [0, 0] },
  rHand: relaxedHand(),
  lHand: relaxedHand(),
  head: [0, 0, 0],
  spine: [0, 0, 0],
};

/**
 * Рабочая стойка дактиля: кисть СБОКУ у щеки (не перед лицом!), ладонь к зрителю.
 * sh[2]=18 (осевое наружу) уводит кисть вбок от головы — иначе на модели RK900
 * (крупнее головой, чем процедурный аватар) прямые пальцы перекрывают лицо.
 * Позиция подобрана числовым стендом ml/.harness/sim.ts (tip.x≈-34, palm.z≈0.8).
 */
export const FS_ARM: ArmPose = { sh: [38, 15, 18], el: 104, tw: -75, wr: [0, 0] };

/** Стойка дактиля целиком (для входа в spell-знак). */
export const FS_BASE: Pose = {
  rArm: FS_ARM,
  lArm: { sh: [10, 8, 0], el: 18, tw: 0, wr: [0, 0] },
  lHand: relaxedHand(),
  head: [2, 0, 0],
};

/** Пауза между словами: кисть приоткрывается, чуть опускается. */
export const GAP_POSE: Pose = {
  rArm: { sh: [40, 14, 18], el: 96, tw: -70, wr: [0, 0] },
  rHand: {
    thumb: { spread: 22, oppose: 10, curl: 8 },
    index: { curl: 16, spread: 4 },
    middle: { curl: 18, spread: 0 },
    ring: { curl: 18, spread: 3 },
    pinky: { curl: 16, spread: 5 },
  },
};

function relaxedHand(): HandPose {
  return {
    thumb: { spread: 16, oppose: 8, curl: 8 },
    index: { curl: 18, spread: 3 },
    middle: { curl: 20, spread: 0 },
    ring: { curl: 20, spread: 2 },
    pinky: { curl: 18, spread: 4 },
  };
}

// ── Конструкторы форм кисти ──────────────────────────────────────────────────
// Каждая буква задаёт ВСЕ пять пальцев (полная форма кисти): так предыдущая
// буква не «просачивается» в следующую при кумулятивном слиянии в плеере.

const FULL = 96; // палец полностью в кулак

type Curl3 = number | [number, number, number];
type Curl2 = number | [number, number];

interface Digits {
  t?: { spread?: number; oppose?: number; curl?: Curl2 };
  i?: { curl?: Curl3; spread?: number };
  m?: { curl?: Curl3; spread?: number };
  r?: { curl?: Curl3; spread?: number };
  p?: { curl?: Curl3; spread?: number };
}

/** Полная форма кисти: незаданные пальцы — в кулак, большой — прижат. */
function hand(d: Digits): HandPose {
  return {
    thumb: { spread: 0, oppose: 0, curl: 0, ...(d.t ?? { oppose: 46, curl: [26, 20] }) },
    index: { curl: FULL, spread: 0, ...(d.i ?? {}) },
    middle: { curl: FULL, spread: 0, ...(d.m ?? {}) },
    ring: { curl: FULL, spread: 0, ...(d.r ?? {}) },
    pinky: { curl: FULL, spread: 0, ...(d.p ?? {}) },
  };
}

const st = (spread = 0) => ({ curl: 0 as Curl3, spread }); // прямой палец

/** Буква = только форма правой кисти (рука остаётся в FS_BASE). */
const L = (h: HandPose): LetterDef => ({ pose: { rHand: h } });

/** Буква с переопределением руки (горизонтальные/опущенные формы). */
const LA = (h: HandPose, arm: ArmPose): LetterDef => ({ pose: { rHand: h, rArm: arm } });

// ── ASL: пальцевая азбука (26 букв) ─────────────────────────────────────────
// Палм-ориентация по умолчанию — к зрителю (FS_ARM). G/H/P/Q — со своей рукой.

const ASL_G_ARM: ArmPose = { sh: [44, 9, 0], el: 120, tw: -14, wr: [0, 0] }; // кисть поперёк
const ASL_PQ_ARM: ArmPose = { sh: [44, 13, 0], el: 80, tw: -55, wr: [50, 0] }; // кисть вниз

const aslA = hand({ t: { spread: 14, oppose: 0, curl: [0, 8] } });
const aslI = hand({ p: st(8), t: { oppose: 42, curl: [28, 22] } });
const aslS = hand({ t: { spread: 0, oppose: 55, curl: [36, 30] } });

export const ASL_ALPHABET: Record<string, LetterDef> = {
  a: L(aslA),
  b: L(hand({ i: st(), m: st(), r: st(), p: st(), t: { spread: 0, oppose: 58, curl: [30, 22] } })),
  c: L(
    hand({
      i: { curl: [34, 42, 30], spread: 3 },
      m: { curl: [34, 42, 30] },
      r: { curl: [34, 42, 30], spread: 3 },
      p: { curl: [34, 42, 30], spread: 5 },
      t: { spread: 36, oppose: 18, curl: [16, 12] },
    }),
  ),
  d: L(
    hand({
      i: st(),
      m: { curl: [58, 62, 46] },
      r: { curl: [58, 62, 46] },
      p: { curl: [58, 62, 46] },
      t: { spread: 8, oppose: 46, curl: [26, 22] },
    }),
  ),
  e: L(
    hand({
      i: { curl: [62, 84, 60] },
      m: { curl: [62, 84, 60] },
      r: { curl: [62, 84, 60] },
      p: { curl: [60, 80, 58] },
      t: { spread: 0, oppose: 60, curl: [34, 26] },
    }),
  ),
  f: L(
    hand({
      i: { curl: [48, 54, 36] },
      m: st(0),
      r: st(8),
      p: st(10),
      t: { spread: 18, oppose: 44, curl: [20, 14] },
    }),
  ),
  g: LA(hand({ i: st(), t: { spread: 28, oppose: 0, curl: 0 } }), ASL_G_ARM),
  h: LA(hand({ i: st(), m: st(), t: { oppose: 30, curl: [22, 16] } }), ASL_G_ARM),
  i: L(aslI),
  // J: мизинец «рисует» хвостик буквы — движение кистью/предплечьем.
  j: {
    frames: [
      { t: 0, pose: { rHand: aslI, rArm: FS_ARM } },
      { t: 230, pose: { rArm: { tw: -116, wr: [16, -22] } } },
      { t: 430, pose: { rArm: { tw: -84, wr: [0, -6] } } },
    ],
    hold: 130,
  },
  k: L(
    hand({
      i: st(3),
      m: { curl: [52, 4, 0], spread: -8 },
      t: { spread: 6, oppose: 52, curl: [6, 4] },
    }),
  ),
  l: L(hand({ i: st(), t: { spread: 52, oppose: 0, curl: 0 } })),
  m: L(
    hand({
      i: { curl: [74, 58, 40] },
      m: { curl: [74, 58, 40] },
      r: { curl: [74, 58, 40] },
      t: { spread: 0, oppose: 64, curl: [26, 20] },
    }),
  ),
  n: L(
    hand({
      i: { curl: [74, 58, 40] },
      m: { curl: [74, 58, 40] },
      t: { spread: 0, oppose: 58, curl: [26, 20] },
    }),
  ),
  o: L(
    hand({
      i: { curl: [50, 56, 44] },
      m: { curl: [50, 56, 44] },
      r: { curl: [50, 56, 44] },
      p: { curl: [48, 54, 42] },
      t: { spread: 22, oppose: 42, curl: [24, 18] },
    }),
  ),
  p: LA(
    hand({
      i: st(3),
      m: { curl: [52, 4, 0], spread: -8 },
      t: { spread: 6, oppose: 52, curl: [6, 4] },
    }),
    ASL_PQ_ARM,
  ),
  q: LA(hand({ i: st(), t: { spread: 26, oppose: 0, curl: 0 } }), ASL_PQ_ARM),
  // R ≈ скрещенные пальцы (приближение: spread сводит их крест-накрест).
  r: L(
    hand({
      i: { curl: [6, 0, 0], spread: -9 },
      m: { curl: [14, 2, 0], spread: 14 },
      t: { oppose: 46, curl: [26, 20] },
    }),
  ),
  s: L(aslS),
  t: L(
    hand({
      i: { curl: [78, 52, 34] },
      t: { spread: 8, oppose: 34, curl: [16, 10] },
    }),
  ),
  u: L(hand({ i: st(), m: st(), t: { oppose: 44, curl: [28, 22] } })),
  v: L(hand({ i: st(17), m: st(-14), t: { oppose: 44, curl: [28, 22] } })),
  w: L(hand({ i: st(13), m: st(), r: st(12), p: { curl: 92 }, t: { oppose: 52, curl: [26, 20] } })),
  x: L(hand({ i: { curl: [14, 86, 66] }, t: { spread: 4, oppose: 40, curl: [22, 16] } })),
  y: L(hand({ p: st(14), t: { spread: 54, oppose: 0, curl: 0 } })),
  // Z: указательный «чертит» зигзаг кистью.
  z: {
    frames: [
      { t: 0, pose: { rHand: hand({ i: st(), t: { oppose: 42, curl: [26, 20] } }), rArm: { ...FS_ARM, wr: [0, 14] } } },
      { t: 170, pose: { rArm: { wr: [0, -14] } } },
      { t: 330, pose: { rArm: { wr: [16, 12] } } },
      { t: 500, pose: { rArm: { wr: [18, -14] } } },
    ],
    hold: 140,
  },
};

// ── Русская дактильная азбука (33 буквы) ─────────────────────────────────────
// Одноручная; многие формы повторяют начертание буквы. Всё, что помечено `≈`,
// — приближение по контуру, требует доводки в «Аватар-лаб» и сверки с носителями.

const DOWN_ARM: ArmPose = { sh: [46, 14, 0], el: 88, tw: -70, wr: [52, 0] }; // пальцы вниз

const ruE = hand({
  i: { curl: [45, 58, 40], spread: 4 },
  m: { curl: [45, 58, 40] },
  r: { curl: [45, 58, 40], spread: 3 },
  p: { curl: [43, 55, 38], spread: 5 },
  t: { spread: 20, oppose: 24, curl: [18, 12] },
}); // ≈ полусогнутый «коготь»

const ruP = hand({ i: st(), m: st(), t: { oppose: 40, curl: [24, 18] } }); // ножки «П»

const ruSh = hand({ i: st(13), m: st(), r: st(12), p: { curl: 92 }, t: { oppose: 52, curl: [26, 20] } }); // три луча «Ш»

export const RU_ALPHABET: Record<string, LetterDef> = {
  а: L(aslA), // кулак, большой сбоку (≈ ASL A)
  б: L(
    hand({
      i: { curl: [40, 52, 38] },
      t: { spread: 34, oppose: 8, curl: [10, 8] },
    }),
  ), // ≈ дуга указательного + отставленный большой («б»)
  в: L(hand({ i: st(), m: st(), r: st(), p: st(), t: { spread: 0, oppose: 58, curl: [30, 22] } })), // четыре пальца («В»)
  г: L(hand({ i: st(), t: { spread: 50, oppose: 0, curl: 0 } })), // прямой угол («Г»)
  д: {
    // ≈ «ножки» буквы Д: два пальца вниз + лёгкое касание.
    frames: [
      { t: 0, pose: { rHand: hand({ i: st(10), m: st(-10), t: { oppose: 40, curl: [24, 18] } }), rArm: DOWN_ARM } },
      { t: 200, pose: { rArm: { wr: [60, 0] } } },
      { t: 360, pose: { rArm: { wr: [50, 0] } } },
    ],
    hold: 120,
  },
  е: L(ruE),
  ё: {
    // Е + «точки»: короткое потряхивание кистью.
    frames: [
      { t: 0, pose: { rHand: ruE, rArm: FS_ARM } },
      { t: 140, pose: { rArm: { wr: [0, 12] } } },
      { t: 280, pose: { rArm: { wr: [0, -10] } } },
      { t: 400, pose: { rArm: { wr: [0, 0] } } },
    ],
    hold: 110,
  },
  ж: L(
    hand({
      i: { curl: [36, 40, 28], spread: 14 },
      m: { curl: [36, 40, 28] },
      r: { curl: [36, 40, 28], spread: 12 },
      p: { curl: 90 },
      t: { spread: 30, oppose: 14, curl: [8, 6] },
    }),
  ), // ≈ три полусогнутых «луча» («Ж»)
  з: {
    // ≈ крючок указательного «чертит» зигзаг («З»).
    frames: [
      { t: 0, pose: { rHand: hand({ i: { curl: [14, 86, 66] }, t: { spread: 4, oppose: 40, curl: [22, 16] } }), rArm: { ...FS_ARM, wr: [0, 12] } } },
      { t: 200, pose: { rArm: { wr: [10, -12] } } },
      { t: 400, pose: { rArm: { wr: [22, 10] } } },
    ],
    hold: 130,
  },
  и: L(hand({ i: st(15), m: st(-12), t: { oppose: 44, curl: [28, 22] } })), // ≈ две «палочки» («И»)
  й: {
    // И + «кратка»: волна кистью.
    frames: [
      { t: 0, pose: { rHand: hand({ i: st(15), m: st(-12), t: { oppose: 44, curl: [28, 22] } }), rArm: FS_ARM } },
      { t: 180, pose: { rArm: { wr: [12, 10] } } },
      { t: 360, pose: { rArm: { wr: [0, -8] } } },
      { t: 480, pose: { rArm: { wr: [0, 0] } } },
    ],
    hold: 100,
  },
  к: L(
    hand({
      i: st(3),
      m: { curl: [52, 4, 0], spread: -8 },
      t: { spread: 6, oppose: 52, curl: [6, 4] },
    }),
  ), // ≈ контур «К» (как ASL K)
  л: LA(hand({ i: st(12), m: st(-12), t: { oppose: 40, curl: [24, 18] } }), DOWN_ARM), // ≈ «шалашик» вниз («Л»)
  м: LA(hand({ i: st(8), m: st(), r: st(8), t: { oppose: 45, curl: [26, 20] } }), DOWN_ARM), // ≈ три «ножки» («М»)
  н: L(
    hand({
      i: st(),
      m: st(),
      t: { spread: 0, oppose: 62, curl: [18, 12] },
    }),
  ), // ≈ две стойки + «перекладина» большим («Н»)
  о: L(
    hand({
      i: { curl: [50, 56, 44] },
      m: { curl: [50, 56, 44] },
      r: { curl: [50, 56, 44] },
      p: { curl: [48, 54, 42] },
      t: { spread: 22, oppose: 42, curl: [24, 18] },
    }),
  ), // кольцо («О», ≈ ASL O)
  п: LA(ruP, DOWN_ARM), // ≈ «ножки» вниз («П»)
  р: L(
    hand({
      i: { curl: [6, 0, 0], spread: -9 },
      m: { curl: [14, 2, 0], spread: 14 },
      t: { oppose: 46, curl: [26, 20] },
    }),
  ), // ≈ скрещенные пальцы (приближение)
  с: L(
    hand({
      i: { curl: [34, 42, 30], spread: 3 },
      m: { curl: [34, 42, 30] },
      r: { curl: [34, 42, 30], spread: 3 },
      p: { curl: [34, 42, 30], spread: 5 },
      t: { spread: 36, oppose: 18, curl: [16, 12] },
    }),
  ), // полукруг («С», ≈ ASL C)
  т: LA(hand({ i: st(6), m: st(), r: st(6), t: { oppose: 42, curl: [26, 20] } }), DOWN_ARM), // ≈ три пальца вниз («Т»)
  у: L(hand({ p: st(14), t: { spread: 54, oppose: 0, curl: 0 } })), // ≈ «рожки» («У», ≈ ASL Y)
  ф: L(
    hand({
      i: { curl: [48, 54, 36] },
      m: st(0),
      r: st(8),
      p: st(10),
      t: { spread: 18, oppose: 44, curl: [20, 14] },
    }),
  ), // ≈ кружок и палочки («Ф», ≈ ASL F)
  х: L(hand({ i: { curl: [14, 86, 66] }, t: { spread: 4, oppose: 40, curl: [22, 16] } })), // ≈ крючок («Х», ≈ ASL X)
  ц: {
    // ≈ «П» + хвостик вниз-в сторону.
    frames: [
      { t: 0, pose: { rHand: ruP, rArm: DOWN_ARM } },
      { t: 220, pose: { rArm: { wr: [62, -14] } } },
      { t: 400, pose: { rArm: { wr: [52, 0] } } },
    ],
    hold: 110,
  },
  ч: L(
    hand({
      i: { curl: [88, 6, 0] },
      m: { curl: [88, 6, 0] },
      r: { curl: [88, 6, 0] },
      p: { curl: [86, 6, 0] },
      t: { spread: 24, oppose: 30, curl: 0 },
    }),
  ), // ≈ «ковшик» («Ч»)
  ш: L(ruSh), // три «луча» вверх («Ш», ≈ ASL W)
  щ: {
    // Ш + хвостик.
    frames: [
      { t: 0, pose: { rHand: ruSh, rArm: FS_ARM } },
      { t: 220, pose: { rArm: { wr: [18, -14] } } },
      { t: 380, pose: { rArm: { wr: [0, 0] } } },
    ],
    hold: 110,
  },
  ъ: {
    // ≈ «Ь» + штрих вперёд.
    frames: [
      { t: 0, pose: { rHand: hand({ i: { curl: [30, 58, 42] }, t: { spread: 26, oppose: 10, curl: [8, 6] } }), rArm: FS_ARM } },
      { t: 220, pose: { rArm: { sh: [56, 15, 0] } } },
      { t: 400, pose: { rArm: { sh: [50, 15, 0] } } },
    ],
    hold: 110,
  },
  ы: L(hand({ p: st(10), t: { spread: 44, oppose: 0, curl: 0 } })), // ≈ «палочка» мизинца + большой («ы»)
  ь: L(hand({ i: { curl: [58, 64, 40] }, t: { oppose: 30, curl: [14, 10] } })), // ≈ «петелька» («Ь»)
  э: L(
    hand({
      i: { curl: [48, 56, 40] },
      m: { curl: [34, 42, 30] },
      r: { curl: [34, 42, 30], spread: 3 },
      p: { curl: [34, 42, 30], spread: 5 },
      t: { spread: 36, oppose: 18, curl: [16, 12] },
    }),
  ), // ≈ «С» с язычком указательного («Э»)
  ю: L(
    hand({
      i: st(14),
      m: { curl: [52, 58, 44] },
      r: { curl: [52, 58, 44] },
      p: { curl: [50, 56, 42] },
      t: { spread: 18, oppose: 46, curl: [22, 16] },
    }),
  ), // ≈ «палочка + кружок» («Ю»)
  я: L(
    hand({
      i: st(),
      m: { curl: [46, 6, 0], spread: -10 },
      t: { spread: 10, oppose: 50, curl: [8, 4] },
    }),
  ), // ≈ стойка с «ножкой» вперёд («Я»)
};

/** Найти определение буквы для алфавита (буквы приходят в нижнем регистре). */
export function letterDef(alphabet: "asl" | "ru", letter: string): LetterDef | undefined {
  return (alphabet === "ru" ? RU_ALPHABET : ASL_ALPHABET)[letter];
}
