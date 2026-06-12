// Скиновая модель (Mixamo glTF) как тело собственного аватара SoundSight.
//
// Drop-in замена процедурного Humanoid: тот же интерфейс { root, applyChannels },
// поэтому player.ts просто подставляет один объект вместо другого. Внутри —
// невидимый процедурный Humanoid в роли ДРАЙВЕРА: его суставы крутятся по
// проверенной канальной математике (humanoid.ts), а сюда переносятся их повороты
// на одноимённые кости модели.
//
// РУКИ/КОРПУС: перенос мировой дельты поворота. Для кости b:
//     target_world(b) = Δ · rest_world(b),  Δ = q_now · q_bind⁻¹
// корректно при любом roll кости, если драйвер в bind физически совпадает с rest
// модели (см. MIXAMO_BIND, A-поза).
//
// ПАЛЬЦЫ (Index/Middle/Ring/Pinky): мировая дельта НЕ годится — у косточек Mixamo
// своя ось сгиба, и перенос «как есть» (даже с выравниванием по ладони) уводит
// сгиб вбок: «кулак» растопыривается, а не сжимается (проверено числовым стендом
// ml/.harness). Поэтому палец гнётся вокруг ИЗМЕРЕННОЙ из rest-скелета flex-оси
// модели на УГОЛ сгиба, который сделал драйвер:
//     bone.local = R(flexLocal, dir·θ) · rest_local,   θ = |угол сгиба сустава драйвера|
// flexLocal = ось сгиба пальца (направление пальца × нормаль ладони) в кадре
// родителя; dir (в какую сторону «в кулак») определяется геометрически — поэтому
// работает на обеих зеркальных кистях. Большой палец остаётся на дельта-переносе.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { Humanoid } from "./humanoid";
import { flattenPose, type Channels } from "./poseTypes";
import { BONE_MAP, HAND_OF, MIXAMO_BIND, cleanMixamoName } from "./mixamoRig";

const TARGET_HEIGHT = 1.9; // метры; рост модели подгоняется под кадр камеры
const FINGER_RE = /Hand(Index|Middle|Ring|Pinky)/; // пальцы кроме большого

const wpos = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

/** Нормаль ладони (мировая) из rest-точек: запястье, MCP указательного и мизинца. */
function palmNormal(side: string, bones: Map<string, THREE.Object3D>): THREE.Vector3 {
  const w = wpos(bones.get(side + "Hand")!);
  const i = wpos(bones.get(side + "HandIndex1")!);
  const p = wpos(bones.get(side + "HandPinky1")!);
  return i.clone().sub(w).cross(p.clone().sub(w)).normalize();
}

/** Ось сгиба пальца (мировая): направление пальца × нормаль ладони. */
function fingerFlexAxis(side: string, f: string, pn: THREE.Vector3, bones: Map<string, THREE.Object3D>): THREE.Vector3 {
  const a = wpos(bones.get(`${side}Hand${f}1`)!);
  const b = wpos(bones.get(`${side}Hand${f}3`)!);
  return b.clone().sub(a).normalize().cross(pn).normalize();
}

/** Знак сгиба: +поворот должен вести кончик пальца К ЗАПЯСТЬЮ (в кулак). */
function curlDir(side: string, f: string, flex: THREE.Vector3, bones: Map<string, THREE.Object3D>): number {
  const w = wpos(bones.get(side + "Hand")!);
  const mcp = wpos(bones.get(`${side}Hand${f}1`)!);
  const tip = wpos(bones.get(`${side}Hand${f}4`)!);
  const dist = (deg: number) => tip.clone().sub(mcp).applyAxisAngle(flex, (deg * Math.PI) / 180).add(mcp).distanceTo(w);
  return dist(30) < dist(-30) ? 1 : -1;
}

interface Pair {
  bone: THREE.Object3D; // кость модели
  driver: THREE.Object3D; // соответствующий сустав драйвера
  restWorld: THREE.Quaternion; // мировой поворот кости в rest
  bindInv: THREE.Quaternion; // (мировой поворот драйвера в bind)⁻¹
  driverHand?: THREE.Object3D; // для большого пальца — кисть драйвера (выравнивание)
  boneHand?: THREE.Object3D; // для большого пальца — кисть модели
  // Поля пальцевого ретаргета (Index/Middle/Ring/Pinky):
  finger?: boolean;
  flexLocal?: THREE.Vector3; // ось сгиба в кадре родителя кости
  restLocal?: THREE.Quaternion; // локальный поворот кости в rest
  bindLocal?: THREE.Quaternion; // локальный поворот сустава драйвера в bind
  dir?: number; // знак направления «в кулак»
}

export class SkinnedHumanoid {
  /** Узел, добавляемый в сцену плеера (внутрь — загруженная модель). */
  readonly root = new THREE.Group();

  private driver = new Humanoid();
  private bindQ: Record<string, THREE.Quaternion> = {};
  private bindLocal: Record<string, THREE.Quaternion> = {};
  private pairs: Pair[] = [];
  private loaded = false;

  // Переиспользуемые временные кватернионы (без аллокаций в кадре).
  private _qNow = new THREE.Quaternion();
  private _delta = new THREE.Quaternion();
  private _target = new THREE.Quaternion();
  private _parent = new THREE.Quaternion();
  private _hd = new THREE.Quaternion();
  private _hm = new THREE.Quaternion();
  private _align = new THREE.Quaternion();
  private _alignInv = new THREE.Quaternion();
  private _rel = new THREE.Quaternion();
  private _fq = new THREE.Quaternion();

  constructor() {
    // Связываем драйвер в A-позе Mixamo и запоминаем повороты суставов
    // (мировые — для рук, локальные — для пальцев).
    const seg = this.driver.driverSegments();
    this.driver.applyChannels(flattenPose(MIXAMO_BIND));
    this.driver.root.updateMatrixWorld(true);
    for (const key in seg) {
      this.bindQ[key] = seg[key].getWorldQuaternion(new THREE.Quaternion());
      this.bindLocal[key] = seg[key].quaternion.clone();
    }
  }

  /** Загрузить и привязать модель. Бросает при сетевой/парсинг-ошибке. */
  async load(url: string): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = gltf.scene;

    const bones = new Map<string, THREE.Object3D>();
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone || o.type === "Bone") {
        bones.set(cleanMixamoName(o.name), o);
      }
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh) mesh.frustumCulled = false; // bbox после ретаргета врёт
    });

    this.root.add(model);
    this.fit(model);
    this.root.updateMatrixWorld(true);

    const seg = this.driver.driverSegments();
    const missing: string[] = [];
    const palm: Record<string, THREE.Vector3> = {};
    for (const b of BONE_MAP) {
      const bone = bones.get(b.bone);
      const driver = seg[b.bone];
      if (!bone || !driver) {
        missing.push(b.bone);
        continue;
      }
      const pair: Pair = {
        bone,
        driver,
        restWorld: bone.getWorldQuaternion(new THREE.Quaternion()),
        bindInv: this.bindQ[b.bone].clone().invert(),
      };
      if (b.fingerOf) {
        const fm = FINGER_RE.exec(b.bone);
        if (fm) {
          const pn = palm[b.fingerOf] ?? (palm[b.fingerOf] = palmNormal(b.fingerOf, bones));
          const flexW = fingerFlexAxis(b.fingerOf, fm[1], pn, bones);
          pair.finger = true;
          pair.bindLocal = this.bindLocal[b.bone];
          pair.restLocal = bone.quaternion.clone();
          pair.flexLocal = flexW.clone().applyQuaternion(bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
          pair.dir = curlDir(b.fingerOf, fm[1], flexW, bones);
        } else {
          // большой палец — перенос по ладони (как раньше)
          pair.driverHand = seg[HAND_OF[b.fingerOf]];
          pair.boneHand = bones.get(HAND_OF[b.fingerOf]);
        }
      }
      this.pairs.push(pair);
    }
    if (missing.length) {
      console.warn(`[skinnedHumanoid] не найдены кости: ${missing.join(", ")}`);
    }
    this.loaded = true;
  }

  /** Вписать модель в кадр: единый масштаб по росту, ступни на пол. */
  private fit(model: THREE.Object3D): void {
    model.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(model);
    const h = box.max.y - box.min.y || 1;
    const s = TARGET_HEIGHT / h;
    this.root.scale.setScalar(s);
    this.root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model);
    const c = box.getCenter(new THREE.Vector3());
    this.root.position.set(
      this.root.position.x - c.x,
      this.root.position.y - box.min.y,
      this.root.position.z - c.z,
    );
    this.root.updateMatrixWorld(true);
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  /** Применить канальный срез: гоним драйвер и переносим повороты на кости. */
  applyChannels(ch: Channels): void {
    if (!this.loaded) return;

    this.driver.applyChannels(ch);
    this.driver.root.updateMatrixWorld(true);
    this.root.updateMatrixWorld(true); // обновить нетронутые кости до rest

    for (const p of this.pairs) {
      // ── Пальцы: сгиб вокруг измеренной flex-оси на угол сгиба драйвера ──
      if (p.finger) {
        // угол сгиба сустава драйвера относительно bind (драйвер гнёт вокруг local X)
        this._rel.copy(p.bindLocal!).invert().multiply(p.driver.quaternion);
        const theta = Math.abs(2 * Math.atan2(this._rel.x, this._rel.w));
        this._fq.setFromAxisAngle(p.flexLocal!, p.dir! * theta);
        p.bone.quaternion.copy(this._fq).multiply(p.restLocal!);
        p.bone.updateWorldMatrix(false, false);
        continue;
      }

      // ── Руки/корпус/большой палец: перенос мировой дельты Δ = q_now · q_bind⁻¹ ──
      p.driver.getWorldQuaternion(this._qNow);
      this._delta.copy(this._qNow).multiply(p.bindInv);

      if (p.driverHand && p.boneHand) {
        // большой палец: ось сгиба в систему ладони МОДЕЛИ. Δ' = align · Δ · align⁻¹.
        p.boneHand.getWorldQuaternion(this._hm);
        p.driverHand.getWorldQuaternion(this._hd);
        this._align.copy(this._hm).multiply(this._hd.invert());
        this._alignInv.copy(this._align).invert();
        this._delta.premultiply(this._align).multiply(this._alignInv);
      }

      this._target.copy(this._delta).multiply(p.restWorld);

      if (p.bone.parent) {
        p.bone.parent.getWorldQuaternion(this._parent);
        p.bone.quaternion.copy(this._parent.invert()).multiply(this._target);
      } else {
        p.bone.quaternion.copy(this._target);
      }
      p.bone.updateWorldMatrix(false, false); // потомки прочитают обновлённого родителя
    }
  }

  /** Освобождение ресурсов модели (геометрия/материалы/текстуры). */
  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.pairs = [];
  }
}
