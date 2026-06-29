// Симуляционная среда аватара (без камеры).
//
// Headless-WebGL в Node не собирается (нет VS), поэтому «видим» аватар через
// настоящий браузер (Playwright рендерит /sim.html и делает скриншот). Эта
// страница монтирует аватар на весь экран и выставляет глобальные функции для
// прогона ИЗВЕСТНЫХ синтетических поз кисти — детерминированная проверка
// ориентации без камеры и без зеркальной неоднозначности.
//
//   window.__sim(preset, side)  — синтетическая кисть → solveHandWorld → аватар
//   window.__simQuat(side, x,y,z,w) — задать мировой кватернион кисти напрямую
//
// preset: r_palm_up | r_back_up | l_palm_up | point_up

import { NativeAvatarController } from "./avatar3d/player";
import { solveHandWorld } from "./avatar3d/handOrient";
import type { Vec3 } from "./avatar3d/poseRetarget";
import type { HandWorld, Pose, Quat } from "./avatar3d/poseTypes";

const ctrl = new NativeAvatarController();
const stage = document.getElementById("stage")!;
ctrl.attach(stage);
const label = document.getElementById("label")!;

// Синтетическая кисть в пространстве pts (x вправо, y ВНИЗ, z меньше=ближе).
// Заполняем только нужные солверу ориентиры: wrist(0), index_mcp(5),
// middle_mcp(9), pinky_mcp(17).
function makeHand(i5: Vec3, i9: Vec3, i17: Vec3): Vec3[] {
  const h: Vec3[] = Array.from({ length: 21 }, () => [0, 0, 0] as Vec3);
  h[0] = [0, 100, 0];
  h[5] = i5;
  h[9] = i9;
  h[17] = i17;
  return h;
}

const PRESETS: Record<string, { hand: Vec3[]; side: "r" | "l"; arm: Pose }> = {
  // Правая: ладонь к камере, пальцы вверх. Большой палец у пользователя слева →
  // в сыром (не зеркаленном) кадре справа = +x → index(+x), pinky(−x).
  r_palm_up: {
    hand: makeHand([30, 20, 0], [0, 0, 0], [-30, 20, 0]),
    side: "r",
    arm: { rArm: { sh: [48, 12, 0], el: 92 }, lArm: { sh: [10, 8, 0], el: 18 } },
  },
  // Правая: ТЫЛ к камере (index/pinky местами → нормаль в другую сторону).
  r_back_up: {
    hand: makeHand([-30, 20, 0], [0, 0, 0], [30, 20, 0]),
    side: "r",
    arm: { rArm: { sh: [48, 12, 0], el: 92 }, lArm: { sh: [10, 8, 0], el: 18 } },
  },
  // Левая: ладонь к камере, пальцы вверх (большой справа у пользователя → −x).
  l_palm_up: {
    hand: makeHand([-30, 20, 0], [0, 0, 0], [30, 20, 0]),
    side: "l",
    arm: { lArm: { sh: [48, 12, 0], el: 92 }, rArm: { sh: [10, 8, 0], el: 18 } },
  },
};

function armPose(side: "r" | "l"): Pose {
  return side === "r"
    ? { rArm: { sh: [48, 12, 0], el: 92 }, lArm: { sh: [10, 8, 0], el: 18 } }
    : { lArm: { sh: [48, 12, 0], el: 92 }, rArm: { sh: [10, 8, 0], el: 18 } };
}

// Позу применяем ОДИН раз: собственный RAF контроллера (запущен в attach) сам
// рендерит и доводит позу, а override кисти держится из liveHands каждый кадр —
// поэтому отдельный вечный requestAnimationFrame здесь не нужен.
function apply(side: "r" | "l", q: Quat | null, msg: string): string {
  ctrl.applyLivePose(armPose(side), q ? ({ [side]: q } as HandWorld) : {});
  label.textContent = msg;
  return msg;
}

interface SimWindow {
  __sim?: (preset: string, side?: "r" | "l") => string;
  __simQuat?: (side: "r" | "l", x: number, y: number, z: number, w: number) => string;
  __simRaw?: (side: "r" | "l", pts: Vec3[]) => string;
}

// Воспроизвести РЕАЛЬНЫЕ ориентиры кисти (экспорт из «Зеркала») — точная отладка
// конвенции на настоящих данных, без камеры.
(window as unknown as SimWindow).__simRaw = (side, pts) => {
  const q = solveHandWorld(pts, side);
  return apply(side, q, q
    ? `raw '${side}'  q=(${q.x.toFixed(2)},${q.y.toFixed(2)},${q.z.toFixed(2)},${q.w.toFixed(2)})`
    : `raw '${side}': вырожденный вход (нет базиса)`);
};

(window as unknown as SimWindow).__sim = (preset, side) => {
  const p = PRESETS[preset];
  if (!p) return `нет пресета ${preset}`;
  const s = side ?? p.side;
  const q = solveHandWorld(p.hand, s);
  return apply(s, q, q
    ? `${preset} как '${s}'  q=(${q.x.toFixed(2)},${q.y.toFixed(2)},${q.z.toFixed(2)},${q.w.toFixed(2)})`
    : `${preset}: вырожденный вход`);
};

(window as unknown as SimWindow).__simQuat = (side, x, y, z, w) =>
  apply(side, { x, y, z, w }, `quat '${side}' (${x},${y},${z},${w})`);
