// Контракт поз собственного 3D-аватара SoundSight.
//
// ЕДИНЫЙ формат для: avatar/native_lexicon.json (бэкенд), плеера, редактора
// «Аватар-лаб» и ml/extract_pose_clip.py (захват жестов из видео). Меняется
// только синхронно во всех четырёх местах. Подробно: docs/native_avatar.md.
//
// Все углы — в ГРАДУСАХ, анатомическая семантика (одинаковая для обеих рук,
// зеркалирование знаков делает humanoid.ts):
//   ArmPose.sh = [raise, side, rot]
//     raise — подъём руки вперёд: 0 = висит вдоль тела, 90 = вперёд, 180 = вверх
//     side  — отведение в сторону от тела (абдукция), 0..~120
//     rot   — осевое вращение плеча: + наружу, − внутрь
//   ArmPose.el — сгиб локтя: 0 = прямая, ~150 = полностью согнута
//   ArmPose.tw — вращение предплечья: 0 = ладонь к телу (нейтраль),
//                − пронация (ладонь вниз при горизонтальном предплечье),
//                + супинация (ладонь вверх)
//   ArmPose.wr = [flex, dev]
//     flex — сгиб кисти: + к ладони, − к тылу
//     dev  — отклонение: + к большому пальцу (радиальное), − к мизинцу
//   FingerPose.curl — number (шорткат: распределяется по трём фалангам)
//                     или [mcp, pip, dip]; 0 = прямой, ~95 = в кулак
//   FingerPose.spread — растопыривание от среднего пальца, градусы
//   ThumbPose: spread — отведение от ладони в её плоскости,
//              oppose — оппозиция (поворот поперёк ладони к мизинцу),
//              curl   — number или [mcp, ip]
//   head  = [nod(+вниз), turn(+влево от аватара), tilt]
//   spine = [bend(+вперёд), turn, tilt]
//
// Позы ЧАСТИЧНЫЕ: незаданные суставы наследуются от предыдущего ключевого
// кадра (внутри клипа) или от базовой позы.

export interface ArmPose {
  sh?: [number, number, number];
  el?: number;
  tw?: number;
  wr?: [number, number];
}

export interface FingerPose {
  spread?: number;
  curl?: number | [number, number, number];
}

export interface ThumbPose {
  spread?: number;
  oppose?: number;
  curl?: number | [number, number];
}

export interface HandPose {
  thumb?: ThumbPose;
  index?: FingerPose;
  middle?: FingerPose;
  ring?: FingerPose;
  pinky?: FingerPose;
}

export interface Pose {
  rArm?: ArmPose;
  lArm?: ArmPose;
  rHand?: HandPose;
  lHand?: HandPose;
  head?: [number, number, number];
  spine?: [number, number, number];
}

/** Кватернион {x,y,z,w} — мировая ориентация кисти для live-зеркала. */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Мировые ориентации кистей (live-зеркало): переопределяют запястье аватара. */
export interface HandWorld {
  r?: Quat;
  l?: Quat;
}

// ── Клипы и трек (то, что присылает бэкенд в payload.avatar_pose) ────────────

export interface ClipFrame {
  t: number; // мс от начала клипа
  pose: Pose;
}

export interface GlossClip {
  ru?: string;
  aliases?: string[];
  hold?: number; // мс удержания последнего кадра
  frames: ClipFrame[];
}

export interface NativeLexicon {
  v: number;
  glosses: Record<string, GlossClip>;
}

export type TrackSign =
  | { kind: "gloss"; id: string }
  | { kind: "spell"; alphabet: "asl" | "ru"; letters: string[] }
  | { kind: "gap" };

export interface PoseTrack {
  v: number;
  signs: TrackSign[];
}

// Буква алфавита: статичная форма кисти или мини-клип (J, Z — с движением).
export type LetterDef = { pose: Pose } | { frames: ClipFrame[]; hold?: number };

// ── Канальное представление (для интерполяции в плеере) ─────────────────────
// Поза разворачивается в плоскую карту «канал → градусы», каналы лерпятся
// поштучно. Шорткат curl: number раскладывается здесь.

export type Channels = Record<string, number>;

const FINGERS = ["index", "middle", "ring", "pinky"] as const;

function curl3(c: number | [number, number, number]): [number, number, number] {
  if (Array.isArray(c)) return c;
  const v = Math.max(0, Math.min(110, c));
  return [v, Math.min(110, v * 1.05), v * 0.7];
}

function curl2(c: number | [number, number]): [number, number] {
  if (Array.isArray(c)) return c;
  const v = Math.max(0, Math.min(100, c));
  return [v, v * 0.8];
}

function flattenArm(prefix: string, a: ArmPose, out: Channels): void {
  if (a.sh) {
    out[`${prefix}.sh0`] = a.sh[0];
    out[`${prefix}.sh1`] = a.sh[1];
    out[`${prefix}.sh2`] = a.sh[2];
  }
  if (a.el !== undefined) out[`${prefix}.el`] = a.el;
  if (a.tw !== undefined) out[`${prefix}.tw`] = a.tw;
  if (a.wr) {
    out[`${prefix}.wr0`] = a.wr[0];
    out[`${prefix}.wr1`] = a.wr[1];
  }
}

function flattenHand(prefix: string, h: HandPose, out: Channels): void {
  for (const f of FINGERS) {
    const fp = h[f];
    if (!fp) continue;
    if (fp.spread !== undefined) out[`${prefix}.${f}.spread`] = fp.spread;
    if (fp.curl !== undefined) {
      const [a, b, c] = curl3(fp.curl);
      out[`${prefix}.${f}.c0`] = a;
      out[`${prefix}.${f}.c1`] = b;
      out[`${prefix}.${f}.c2`] = c;
    }
  }
  const t = h.thumb;
  if (t) {
    if (t.spread !== undefined) out[`${prefix}.thumb.spread`] = t.spread;
    if (t.oppose !== undefined) out[`${prefix}.thumb.oppose`] = t.oppose;
    if (t.curl !== undefined) {
      const [a, b] = curl2(t.curl);
      out[`${prefix}.thumb.c0`] = a;
      out[`${prefix}.thumb.c1`] = b;
    }
  }
}

/** Развернуть частичную позу в каналы (только заданные поля). */
export function flattenPose(p: Pose): Channels {
  const out: Channels = {};
  if (p.rArm) flattenArm("rArm", p.rArm, out);
  if (p.lArm) flattenArm("lArm", p.lArm, out);
  if (p.rHand) flattenHand("rHand", p.rHand, out);
  if (p.lHand) flattenHand("lHand", p.lHand, out);
  if (p.head) {
    out["head0"] = p.head[0];
    out["head1"] = p.head[1];
    out["head2"] = p.head[2];
  }
  if (p.spine) {
    out["spine0"] = p.spine[0];
    out["spine1"] = p.spine[1];
    out["spine2"] = p.spine[2];
  }
  return out;
}
