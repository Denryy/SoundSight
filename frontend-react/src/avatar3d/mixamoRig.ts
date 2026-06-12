// Привязка скелета Mixamo к драйвер-гуманоиду SoundSight.
//
// Модель Connor RK900 (и любой риг Mixamo) имеет стандартные кости с именами
// вида `mixamorig:RightForeArm` (+ числовой суффикс после экспорта). Мы НЕ
// сопоставляем каналы осям костей вручную — это хрупко. Вместо этого
// процедурный Humanoid работает невидимым «драйвером»: его суставы крутятся по
// проверенной канальной математике, а skinnedHumanoid.ts переносит их мировые
// повороты на одноимённые кости Mixamo (ретаргет по дельте поворота). Здесь —
// только соответствие имён, bind-поза и нормализация имён. Подробно:
// docs/native_avatar.md, раздел про скиновую модель.

import type { Pose } from "./poseTypes";

/**
 * Поза, в которой драйвер «связывается» (bind): для рук/корпуса перенос идёт по
 * мировой дельте target = Δ·rest, Δ = q_now·q_bind⁻¹ — поэтому драйвер в bind
 * должен физически совпасть с rest модели.
 *
 * Руки: rest Mixamo — A-поза (подъём ≈ 0, отведение ≈ 44, локоть ≈ 13), не T-поза.
 * Значения проверены замером rest-скелета: node ml/inspect_rig.mjs (при смене .glb
 * пересчитать руки им же).
 *
 * Пальцы здесь НЕ задаём специально: их ретаргет (skinnedHumanoid.ts) гнёт каждый
 * палец вокруг flex-оси, ИЗМЕРЕННОЙ из rest самой модели, на угол сгиба драйвера —
 * расслабленная/согнутая rest-кисть модели учитывается автоматически. Поэтому bind
 * пальцев должен быть НУЛЕВЫМ (прямые пальцы), иначе он сдвинет угол сгиба.
 */
export const MIXAMO_BIND: Pose = {
  rArm: { sh: [0, 44, 0], el: 13 },
  lArm: { sh: [0, 44, 0], el: 13 },
};

/** Кость Mixamo, чью мировую ориентацию задаёт драйвер-сегмент. */
export interface BoneBinding {
  /** «Чистое» имя кости Mixamo (= ключ Humanoid.driverSegments). */
  bone: string;
  /** Палец: ретаргет с авто-выравниванием по ладони соответствующей кисти. */
  fingerOf?: "Right" | "Left";
}

/**
 * Кости, которыми мы управляем, в порядке родитель→потомок (важно: локальный
 * поворот потомка считается от УЖЕ обновлённого родителя). Кончики пальцев
 * (…4), ключицы, нижние позвонки и шея не трогаются — остаются в rest модели.
 */
export const BONE_MAP: BoneBinding[] = [
  { bone: "Spine2" },
  { bone: "Head" },

  { bone: "RightArm" },
  { bone: "RightForeArm" },
  { bone: "RightHand" },
  { bone: "RightHandThumb1", fingerOf: "Right" },
  { bone: "RightHandThumb2", fingerOf: "Right" },
  { bone: "RightHandThumb3", fingerOf: "Right" },
  { bone: "RightHandIndex1", fingerOf: "Right" },
  { bone: "RightHandIndex2", fingerOf: "Right" },
  { bone: "RightHandIndex3", fingerOf: "Right" },
  { bone: "RightHandMiddle1", fingerOf: "Right" },
  { bone: "RightHandMiddle2", fingerOf: "Right" },
  { bone: "RightHandMiddle3", fingerOf: "Right" },
  { bone: "RightHandRing1", fingerOf: "Right" },
  { bone: "RightHandRing2", fingerOf: "Right" },
  { bone: "RightHandRing3", fingerOf: "Right" },
  { bone: "RightHandPinky1", fingerOf: "Right" },
  { bone: "RightHandPinky2", fingerOf: "Right" },
  { bone: "RightHandPinky3", fingerOf: "Right" },

  { bone: "LeftArm" },
  { bone: "LeftForeArm" },
  { bone: "LeftHand" },
  { bone: "LeftHandThumb1", fingerOf: "Left" },
  { bone: "LeftHandThumb2", fingerOf: "Left" },
  { bone: "LeftHandThumb3", fingerOf: "Left" },
  { bone: "LeftHandIndex1", fingerOf: "Left" },
  { bone: "LeftHandIndex2", fingerOf: "Left" },
  { bone: "LeftHandIndex3", fingerOf: "Left" },
  { bone: "LeftHandMiddle1", fingerOf: "Left" },
  { bone: "LeftHandMiddle2", fingerOf: "Left" },
  { bone: "LeftHandMiddle3", fingerOf: "Left" },
  { bone: "LeftHandRing1", fingerOf: "Left" },
  { bone: "LeftHandRing2", fingerOf: "Left" },
  { bone: "LeftHandRing3", fingerOf: "Left" },
  { bone: "LeftHandPinky1", fingerOf: "Left" },
  { bone: "LeftHandPinky2", fingerOf: "Left" },
  { bone: "LeftHandPinky3", fingerOf: "Left" },
];

/** Кисть, к которой относится палец (для выравнивания плоскости сгиба). */
export const HAND_OF: Record<"Right" | "Left", string> = {
  Right: "RightHand",
  Left: "LeftHand",
};

const MIXAMO_RE = /^mixamorig[:_]?(.+?)(_\d+)?$/i;

/**
 * Нормализует имя кости Mixamo: убирает префикс `mixamorig:` и числовой
 * суффикс экспортёра (`RightHandMiddle3_00` → `RightHandMiddle3`).
 */
export function cleanMixamoName(raw: string): string {
  const m = MIXAMO_RE.exec(raw);
  return m ? m[1] : raw;
}
