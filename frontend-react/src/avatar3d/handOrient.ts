// Ориентация кисти из полного базиса ладони (живое зеркало).
//
// Канальный путь (tw/wr) брал опору для скрутки ладони из торс-системы и
// вырождался, когда предплечье шло вдоль опорной оси → tw «плавал». Здесь
// строим ПОЛНЫЙ ортонормированный базис кисти прямо из landmark'ов MediaPipe
// (как Kalidokit: wrist + index_mcp + pinky_mcp + middle_mcp) и отдаём мировой
// кватернион для кости запястья — без единой опоры, без вырождения, без торса.
//
// Оси меш-кисти аватара (humanoid.ts buildHand): пальцы вдоль −Y, ладонь +Z,
// большой палец со стороны side·+X. Возвращаем целевую мировую ориентацию узла
// «Hand» (wrDev) с учётом преднаклона handBase Ry(side·90°).

import * as THREE from "three";
import type { Vec3 } from "./poseRetarget";
import type { Quat } from "./poseTypes";

// Конвенции перевода координат MediaPipe → мир аватара (аватар смотрит в +Z,
// +Y вверх). Изображение: x вправо, y ВНИЗ, z — меньше = ближе к камере.
// Если ориентация окажется зеркальной — менять эти знаки (одна правка).
const SX = 1;  // горизонталь
const SY = -1; // y вниз → вверх
const SZ = -1; // ближе(−) → к камере(+Z)

const I_WRIST = 0;
const I_INDEX_MCP = 5;
const I_MIDDLE_MCP = 9;
const I_PINKY_MCP = 17;

// Переиспользуемые временные объекты (без аллокаций в кадре).
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _vi = new THREE.Vector3();
const _vp = new THREE.Vector3();
const _wrist = new THREE.Vector3();
const _idx = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _pky = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _ry = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);
const EPS2 = 1e-12; // порог квадрата длины: ниже — вырожденный вход

function v(out: THREE.Vector3, hl: Vec3[], i: number): THREE.Vector3 {
  return out.set(SX * hl[i][0], SY * hl[i][1], SZ * hl[i][2]);
}

/**
 * Мировой кватернион узла «Hand» (wrDev) аватара под ориентацию кисти из
 * landmark'ов. hl — 21 ориентир кисти (пиксельные, изотропные [x·W, y·H, z·W]).
 * Возвращает null при вырожденном входе (совпавшие/перекрытые точки) — кадр без
 * валидного базиса лучше пропустить, чем выдать мусорную ориентацию/NaN.
 */
export function solveHandWorld(hl: Vec3[], side: "r" | "l"): Quat | null {
  v(_wrist, hl, I_WRIST);
  v(_idx, hl, I_INDEX_MCP);
  v(_mid, hl, I_MIDDLE_MCP);
  v(_pky, hl, I_PINKY_MCP);

  // Палм-нормаль (палмарная сторона наружу = меш +Z). Порядок векторного
  // произведения по руке; знак подобран так, чтобы аватар показывал ЛАДОНЬ, а не
  // тыл (правая [index × pinky], левая [pinky × index]).
  _vi.copy(_idx).sub(_wrist);
  _vp.copy(_pky).sub(_wrist);
  if (side === "r") _z.copy(_vi).cross(_vp);
  else _z.copy(_vp).cross(_vi);
  _y.copy(_mid).sub(_wrist).multiplyScalar(-1); // меш +Y = −направление пальцев (ещё не нормирован)

  // Вырожденный вход: нет ладонной нормали (точки коллинеарны/совпали) или нет
  // направления пальцев → базис не построить. Пропускаем кадр.
  if (_z.lengthSq() < EPS2 || _y.lengthSq() < EPS2) return null;

  _z.normalize(); // меш +Z = нормаль ладони
  _y.normalize();
  _x.copy(_y).cross(_z); // меш +X = Y×Z (сторона большого)
  if (_x.lengthSq() < EPS2) return null; // пальцы ∥ нормали — вырождение
  _x.normalize();
  _z.copy(_x).cross(_y).normalize(); // до-ортонормировка

  _m.makeBasis(_x, _y, _z);
  _q.setFromRotationMatrix(_m);

  // Компенсация преднаклона ладони handBase Ry(side·90): wrDev = handMesh · Ry⁻¹.
  const sideSign = side === "r" ? 1 : -1;
  _ry.setFromAxisAngle(_yAxis, -sideSign * Math.PI / 2);
  _q.multiply(_ry);

  return { x: _q.x, y: _q.y, z: _q.z, w: _q.w };
}
