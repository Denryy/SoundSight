#!/usr/bin/env python3
"""Захват жеста из видео → клип для собственного 3D-аватара SoundSight.

Видео человека, показывающего жест (фронтально, по пояс) прогоняется через
MediaPipe Holistic, после чего 3D-ориентиры (landmarks) анатомически
ретаргетятся в формат поз проекта (см. frontend-react/src/avatar3d/poseTypes.ts
и docs/native_avatar.md): углы плеча/локтя/кисти и сгибы пальцев в градусах.
Результат — клип `{ru, hold, frames:[{t, pose}]}`, готовый для вставки в
`avatar/native_lexicon.json` (или сразу `--merge` туда).

Примеры:
    # отдельный файл клипа
    python ml/extract_pose_clip.py video/privet.mp4 --gloss hello --ru "привет" \
        --out hello.json

    # сразу дописать/заменить глосс в лексиконе бэкенда
    python ml/extract_pose_clip.py video/spasibo.mp4 --gloss thanks --ru "спасибо" \
        --merge avatar/native_lexicon.json --start 0.4 --end 2.1

    # самопроверка математики ретаргета (MediaPipe не нужен)
    python ml/extract_pose_clip.py --self-test

Точность (честно):
  * подъём/отведение плеча, локоть, сгибы пальцев — устойчивые величины;
  * вращение плеча (rot), предплечья (tw) и кисть (wr) из монокулярного видео
    оцениваются приблизительно — после захвата доводите их в «Аватар-лабе»;
  * растопырка пальцев (spread) шумная, по умолчанию пишется только если
    заметная.

Зависимости: uv sync --extra ml (mediapipe, opencv-python, numpy).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

# ── Индексы ориентиров MediaPipe ─────────────────────────────────────────────
# Pose (Holistic.pose_world_landmarks) — используем мировые координаты (метры).
P_NOSE, P_LEAR, P_REAR = 0, 7, 8
P_LSH, P_RSH, P_LEL, P_REL, P_LWR, P_RWR = 11, 12, 13, 14, 15, 16
P_LHIP, P_RHIP = 23, 24
# Hand (21 точка): запястье + по 4 на палец.
H_WRIST = 0
H_THUMB = (1, 2, 3, 4)          # CMC, MCP, IP, TIP
H_FINGERS = {                   # MCP, PIP, DIP, TIP
    "index": (5, 6, 7, 8),
    "middle": (9, 10, 11, 12),
    "ring": (13, 14, 15, 16),
    "pinky": (17, 18, 19, 20),
}

VIS_MIN = 0.5          # минимальная visibility ориентира руки (pose)
ELBOW_FOR_ROT = 20.0   # rot плеча осмыслен только при согнутом локте, °
SPREAD_NOISE = 6.0     # |spread| ниже порога не пишем (шум), °


# ── Векторная геометрия ──────────────────────────────────────────────────────
def unit(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return v / n if n > 1e-9 else np.zeros(3)


def ang(a: np.ndarray, b: np.ndarray) -> float:
    """Невзвешенный угол между векторами, градусы [0..180]."""
    ua, ub = unit(a), unit(b)
    return math.degrees(math.acos(float(np.clip(np.dot(ua, ub), -1.0, 1.0))))


def perp(v: np.ndarray, axis: np.ndarray) -> np.ndarray:
    """Составляющая v, перпендикулярная оси axis (axis — единичный)."""
    return v - np.dot(v, axis) * axis


def signed_about(axis: np.ndarray, v_from: np.ndarray, v_to: np.ndarray) -> float:
    """Знаковый угол от v_from к v_to вокруг axis (правило правой руки), °.

    Оба вектора предварительно проецируются в плоскость ⊥ axis.
    """
    a = unit(axis)
    f, t = unit(perp(v_from, a)), unit(perp(v_to, a))
    if not f.any() or not t.any():
        return 0.0
    return math.degrees(math.atan2(float(np.dot(np.cross(f, t), a)),
                                   float(np.clip(np.dot(f, t), -1.0, 1.0))))


def bend(a: np.ndarray, b: np.ndarray) -> float:
    """Сгиб сустава между последовательными сегментами →a и →b.

    Направляющие векторы прямой цепочки параллельны (угол 0 = сустав прямой),
    при сгибании угол между ними растёт до 180 (полностью сложен)."""
    return ang(a, b)


def r(v: float) -> int:
    return int(round(v))


# ── Торсовая система координат ───────────────────────────────────────────────
class Torso:
    """Опорный трёхгранник тела: up (таз→плечи), to_right (к правому плечу
    ЧЕЛОВЕКА), fwd (грудь→камера, знак калибруется по носу). Все суставные углы
    меряются в этой системе, поэтому ориентация камеры не важна."""

    def __init__(self, pl: np.ndarray):
        mid_sh = (pl[P_LSH] + pl[P_RSH]) / 2
        mid_hip = (pl[P_LHIP] + pl[P_RHIP]) / 2
        self.up = unit(mid_sh - mid_hip)
        to_right = unit(perp(pl[P_RSH] - pl[P_LSH], self.up))
        fwd = unit(np.cross(to_right, self.up))
        if np.dot(pl[P_NOSE] - mid_sh, fwd) < 0:   # нос должен быть «спереди»
            fwd = -fwd
        self.fwd = fwd
        self.to_right = unit(np.cross(self.up, fwd))
        if np.dot(self.to_right, to_right) < 0:    # сохранить «право человека»
            self.to_right = -self.to_right


# ── Ретаргет: рука (плечо/локоть) ────────────────────────────────────────────
def retarget_arm(side: str, pl: np.ndarray, vis: np.ndarray, t: Torso,
                 palm_n: np.ndarray | None) -> dict | None:
    """ArmPose из мировых ориентиров. palm_n — ладонная нормаль (если есть
    кисть) для оценки tw. Возвращает None, если рука не видна."""
    i_sh, i_el, i_wr = (P_RSH, P_REL, P_RWR) if side == "r" else (P_LSH, P_LEL, P_LWR)
    if min(vis[i_sh], vis[i_el], vis[i_wr]) < VIS_MIN:
        return None

    upper = pl[i_el] - pl[i_sh]
    fore = pl[i_wr] - pl[i_el]
    u, f = unit(upper), unit(fore)
    lateral = t.to_right if side == "r" else -t.to_right

    raise_ = math.degrees(math.atan2(float(np.dot(u, t.fwd)),
                                     float(-np.dot(u, t.up))))
    side_ = math.degrees(math.asin(float(np.clip(np.dot(u, lateral), -1, 1))))
    el = bend(upper, fore)

    # Осевое вращение плеча: куда «смотрит» сгиб локтя относительно базового
    # направления (вперёд). Положительное направление калибруем по lateral —
    # «наружу = +», как в контракте поз.
    rot = 0.0
    if el > ELBOW_FOR_ROT:
        ref = unit(perp(t.fwd, u))
        if np.linalg.norm(ref) < 1e-6:             # рука точно вперёд
            ref = unit(perp(-t.up, u))
        a_f = signed_about(u, ref, f)
        a_lat = signed_about(u, ref, lateral)
        rot = a_f if a_lat >= 0 else -a_f

    arm: dict = {"sh": [r(raise_), r(side_), r(rot)], "el": r(el)}

    # Вращение предплечья из ладонной нормали. tw=0 — ладонь к телу;
    # «+ супинация» проверено на эталонных позах в --self-test.
    if palm_n is not None and np.linalg.norm(fore) > 1e-6:
        n0 = unit(perp(-lateral, f))
        a_n = signed_about(f, n0, palm_n)
        arm["tw"] = r(-a_n if side == "r" else a_n)
    return arm


# ── Ретаргет: кисть и пальцы ─────────────────────────────────────────────────
def palm_normal(side: str, hl: np.ndarray) -> np.ndarray:
    """Ладонная нормаль (наружу из ладони). Топология MediaPipe: для правой
    руки cross(индекс−запястье, мизинец−запястье) выходит из ладонной стороны;
    для левой — зеркально."""
    vi = hl[H_FINGERS["index"][0]] - hl[H_WRIST]
    vp = hl[H_FINGERS["pinky"][0]] - hl[H_WRIST]
    n = np.cross(vi, vp) if side == "r" else np.cross(vp, vi)
    return unit(n)


def retarget_hand(side: str, hl: np.ndarray, fore: np.ndarray | None) -> tuple[dict, list | None]:
    """HandPose (+ кисть wr, если известно направление предплечья fore)."""
    w = hl[H_WRIST]
    n = palm_normal(side, hl)
    mid_dir = unit(hl[H_FINGERS["middle"][0]] - w)
    radial = unit(perp(perp(hl[H_THUMB[0]] - w, mid_dir), n))  # к большому пальцу

    hand: dict = {}
    spread_sign = math.copysign(1.0, signed_about(n, mid_dir, radial) or 1.0)

    for name, (mcp, pip_, dip, tip) in H_FINGERS.items():
        meta = hl[mcp] - w
        prox = hl[pip_] - hl[mcp]
        c0 = bend(meta, prox)
        c1 = bend(prox, hl[dip] - hl[pip_])
        c2 = bend(hl[dip] - hl[pip_], hl[tip] - hl[dip])
        fp: dict = {"curl": [r(np.clip(c0, 0, 115)), r(np.clip(c1, 0, 115)),
                             r(np.clip(c2, 0, 115))]}
        if name != "middle":
            sp = signed_about(n, mid_dir, unit(prox)) * spread_sign
            if name in ("ring", "pinky"):
                sp = -sp                      # «+» = от среднего пальца
            if abs(sp) >= SPREAD_NOISE:
                fp["spread"] = r(np.clip(sp, -20, 35))
        hand[name] = fp

    # Большой палец: spread — в плоскости ладони, oppose — поперёк неё.
    cmc, mcp, ip_, tip = H_THUMB
    tdir = hl[mcp] - hl[cmc]
    t_in = perp(tdir, n)
    spread = ang(t_in, mid_dir) if np.linalg.norm(t_in) > 1e-6 else 0.0
    oppose = math.degrees(math.atan2(float(np.dot(unit(tdir), n)),
                                     float(np.linalg.norm(t_in) / (np.linalg.norm(tdir) + 1e-9))))
    hand["thumb"] = {
        "spread": r(np.clip(spread, 0, 60)),
        "oppose": r(np.clip(oppose, 0, 70)),
        "curl": [r(np.clip(bend(tdir, hl[ip_] - hl[mcp]), 0, 100)),
                 r(np.clip(bend(hl[ip_] - hl[mcp], hl[tip] - hl[ip_]), 0, 100))],
    }

    wr = None
    if fore is not None:
        a = unit(fore)
        h = hl[H_FINGERS["middle"][0]] - w
        flex = math.degrees(math.atan2(float(np.dot(h, n)), float(np.dot(h, a))))
        h_in = perp(h, n)
        dev = math.degrees(math.atan2(float(np.dot(h, radial)),
                                      float(np.dot(unit(h_in), a) * np.linalg.norm(h_in) + 1e-9)))
        wr = [r(np.clip(flex, -70, 80)), r(np.clip(dev, -40, 40))]
    return hand, wr


# ── Ретаргет: голова ─────────────────────────────────────────────────────────
def retarget_head(pl: np.ndarray, vis: np.ndarray, t: Torso) -> list | None:
    if min(vis[P_NOSE], vis[P_LEAR], vis[P_REAR]) < VIS_MIN:
        return None
    face = pl[P_NOSE] - (pl[P_LEAR] + pl[P_REAR]) / 2
    nod = math.degrees(math.atan2(float(np.dot(face, -t.up)),
                                  float(np.dot(face, t.fwd))))
    turn = math.degrees(math.atan2(float(np.dot(face, -t.to_right)),
                                   float(np.dot(face, t.fwd))))
    if abs(nod) < 6 and abs(turn) < 6:
        return None                               # почти нейтраль — не пишем
    return [r(np.clip(nod, -30, 35)), r(np.clip(turn, -45, 45)), 0]


# ── Кадр → частичная поза ────────────────────────────────────────────────────
def frame_to_pose(pl, vis, lh, rh, t: Torso, hands: str) -> dict:
    pose: dict = {}
    for side, hl, arm_key, hand_key in (("r", rh, "rArm", "rHand"),
                                        ("l", lh, "lArm", "lHand")):
        if hands != "both" and hands != side:
            continue
        n = palm_normal(side, hl) if hl is not None else None
        arm = retarget_arm(side, pl, vis, t, n)
        if arm is not None:
            i_el, i_wr = (P_REL, P_RWR) if side == "r" else (P_LEL, P_LWR)
            fore = pl[i_wr] - pl[i_el]
            if hl is not None:
                hand, wr = retarget_hand(side, hl, fore)
                pose[hand_key] = hand
                if wr is not None:
                    arm["wr"] = wr
            pose[arm_key] = arm
    head = retarget_head(pl, vis, t)
    if head is not None:
        pose["head"] = head
    return pose


# ── Прореживание ключевых кадров ─────────────────────────────────────────────
def _flatten(pose: dict, prefix: str = "") -> dict[str, float]:
    out: dict[str, float] = {}
    for k, v in pose.items():
        key = f"{prefix}{k}"
        if isinstance(v, dict):
            out.update(_flatten(v, key + "."))
        elif isinstance(v, (list, tuple)):
            for i, x in enumerate(v):
                out[f"{key}{i}"] = float(x)
        else:
            out[key] = float(v)
    return out


def thin_keyframes(frames: list[dict], min_delta: float = 4.0,
                   max_gap_ms: int = 400) -> list[dict]:
    """Оставляем кадр, если хоть один канал ушёл от последнего ключевого
    более чем на min_delta° или прошло max_gap_ms. Первый/последний — всегда."""
    if len(frames) <= 2:
        return frames
    kept = [frames[0]]
    last = _flatten(frames[0]["pose"])
    for fr in frames[1:-1]:
        cur = _flatten(fr["pose"])
        keys = set(last) | set(cur)
        delta = max((abs(cur.get(k, 0) - last.get(k, 0)) for k in keys), default=0)
        if delta >= min_delta or fr["t"] - kept[-1]["t"] >= max_gap_ms:
            kept.append(fr)
            last = cur
    kept.append(frames[-1])
    return kept


# ── Извлечение из видео (MediaPipe) ──────────────────────────────────────────
def landmarks_np(lms, w: int, h: int, world: bool):
    """list[Landmark] → (N,3) ndarray (+ visibility для pose).

    Кисти приводим к изотропным «пиксельным» координатам (x·W, y·H, z·W):
    для углов внутри кисти этого достаточно."""
    if world:
        pts = np.array([[p.x, p.y, p.z] for p in lms], dtype=np.float64)
        vis = np.array([getattr(p, "visibility", 1.0) for p in lms])
        return pts, vis
    return np.array([[p.x * w, p.y * h, p.z * w] for p in lms], dtype=np.float64)


def extract_clip(video: Path, fps: float, start: float, end: float | None,
                 hands: str, mirror: bool) -> list[dict]:
    import cv2                                    # noqa: импорт по месту —
    import mediapipe as mp                        # самотест работает без них

    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        sys.exit(f"Не удалось открыть видео: {video}")
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, round(src_fps / fps))

    raw: list[tuple[float, np.ndarray, np.ndarray, np.ndarray | None, np.ndarray | None]] = []
    holistic = mp.solutions.holistic.Holistic(
        model_complexity=1, refine_face_landmarks=False,
        min_detection_confidence=0.5, min_tracking_confidence=0.5)
    with holistic:
        i = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            ts = i / src_fps
            i += 1
            if (i - 1) % step or ts < start or (end is not None and ts > end):
                continue
            if mirror:
                frame = cv2.flip(frame, 1)
            h, w = frame.shape[:2]
            res = holistic.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            if res.pose_world_landmarks is None:
                continue
            pl, vis = landmarks_np(res.pose_world_landmarks.landmark, w, h, True)
            lh = (landmarks_np(res.left_hand_landmarks.landmark, w, h, False)
                  if res.left_hand_landmarks else None)
            rh = (landmarks_np(res.right_hand_landmarks.landmark, w, h, False)
                  if res.right_hand_landmarks else None)
            raw.append((ts, pl, vis, lh, rh))
    cap.release()
    if not raw:
        sys.exit("Поза не распозналась ни в одном кадре: проверьте ракурс/свет.")

    # Сглаживание координат скользящим окном 3 (углы потом не «дрожат»).
    def smooth(idx: int, getter):
        pts = [getter(raw[j]) for j in range(max(0, idx - 1), min(len(raw), idx + 2))
               if getter(raw[j]) is not None]
        return np.mean(pts, axis=0) if pts else None

    t0 = raw[0][0]
    frames = []
    for k, (ts, pl, vis, lh, rh) in enumerate(raw):
        pl_s = smooth(k, lambda x: x[1])
        lh_s = smooth(k, lambda x: x[3]) if lh is not None else None
        rh_s = smooth(k, lambda x: x[4]) if rh is not None else None
        pose = frame_to_pose(pl_s, vis, lh_s, rh_s, Torso(pl_s), hands)
        if pose:
            frames.append({"t": int(round((ts - t0) * 1000)), "pose": pose})
    return frames


# ── Самопроверка математики (без MediaPipe) ──────────────────────────────────
def self_test() -> None:
    X, Y, Z = np.eye(3)        # to_right, up, fwd — синтетический мир
    pl = np.zeros((33, 3))
    vis = np.ones(33)
    pl[P_LSH], pl[P_RSH] = [-0.2, 0.5, 0], [0.2, 0.5, 0]
    pl[P_LHIP], pl[P_RHIP] = [-0.15, 0.0, 0], [0.15, 0.0, 0]
    pl[P_NOSE] = [0, 0.62, 0.1]
    pl[P_LEAR], pl[P_REAR] = [-0.07, 0.6, 0], [0.07, 0.6, 0]

    def arm(sh, el_, wr_, palm=None):
        p = pl.copy()
        p[P_RSH], p[P_REL], p[P_RWR] = sh, el_, wr_
        return retarget_arm("r", p, vis, Torso(p), palm)

    a = arm([0.2, 0.5, 0], [0.2, 0.2, 0], [0.2, -0.1, 0])       # висит
    assert abs(a["sh"][0]) < 3 and abs(a["sh"][1]) < 3 and a["el"] < 3, a
    a = arm([0.2, 0.5, 0], [0.2, 0.5, 0.3], [0.2, 0.5, 0.6])     # вперёд
    assert abs(a["sh"][0] - 90) < 3 and a["el"] < 3, a
    a = arm([0.2, 0.5, 0], [0.5, 0.5, 0], [0.8, 0.5, 0])         # Т-поза
    assert abs(a["sh"][1] - 90) < 3, a
    a = arm([0.2, 0.5, 0], [0.2, 0.2, 0], [0.2, 0.2, 0.3])       # локоть 90°
    assert abs(a["el"] - 90) < 3 and abs(a["sh"][2]) < 5, a
    # супинация: предплечье вперёд, ладонь вверх → tw ≈ +90
    a = arm([0.2, 0.5, 0], [0.2, 0.2, 0], [0.2, 0.2, 0.3], palm=Y)
    assert 80 < a["tw"] < 100, a
    a = arm([0.2, 0.5, 0], [0.2, 0.2, 0], [0.2, 0.2, 0.3], palm=-Y)  # пронация
    assert -100 < a["tw"] < -80, a

    # Кисть: правая ладонь к камере, пальцы вверх (пиксельные координаты, y вниз)
    hl = np.zeros((21, 3))
    hl[H_WRIST] = [500, 800, 0]
    for name, (mcp, pip_, dip, tip) in H_FINGERS.items():
        x = {"index": 560, "middle": 520, "ring": 480, "pinky": 440}[name]
        hl[mcp], hl[pip_], hl[dip], hl[tip] = ([x, 500, 0], [x, 420, 0],
                                               [x, 360, 0], [x, 310, 0])
    hl[1], hl[2], hl[3], hl[4] = ([580, 760, 0], [640, 700, 0],
                                  [680, 660, 0], [710, 630, 0])
    n = palm_normal("r", hl)
    assert n[2] < -0.9, n                       # нормаль к камере (−z экрана)
    hand, wr = retarget_hand("r", hl, fore=np.array([0, -1, 0]))  # предплечье вверх (−y экрана)
    for f in ("index", "middle", "ring", "pinky"):
        assert max(hand[f]["curl"]) < 12, (f, hand[f])
    assert abs(wr[0]) < 12 and abs(wr[1]) < 12, wr
    # кулак: согнём указательный на 90° в PIP
    hl2 = hl.copy()
    hl2[7], hl2[8] = [560, 420, 60], [560, 420, 110]
    hand2, _ = retarget_hand("r", hl2, None)
    assert hand2["index"]["curl"][1] > 75, hand2["index"]

    # Прореживание
    fr = [{"t": i * 66, "pose": {"rArm": {"el": 10 + (i // 5) * 30}}} for i in range(10)]
    thin = thin_keyframes(fr, 4.0)
    assert thin[0]["t"] == 0 and thin[-1]["t"] == fr[-1]["t"] and len(thin) < len(fr)

    print("self-test: OK — математика ретаргета согласована с контрактом поз")


# ── CLI ──────────────────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video", nargs="?", type=Path, help="видеофайл жеста")
    ap.add_argument("--gloss", help="id глосса (латиницей), напр. hello")
    ap.add_argument("--ru", default="", help="русская метка жеста")
    ap.add_argument("--aliases", default="", help="алиасы через запятую")
    ap.add_argument("--fps", type=float, default=15.0, help="частота сэмплов")
    ap.add_argument("--start", type=float, default=0.0, help="начало, сек")
    ap.add_argument("--end", type=float, default=None, help="конец, сек")
    ap.add_argument("--hold", type=int, default=220, help="удержание финала, мс")
    ap.add_argument("--hands", choices=("both", "r", "l"), default="both")
    ap.add_argument("--mirror", action="store_true",
                    help="отзеркалить видео (если снято фронталкой-зеркалом)")
    ap.add_argument("--min-delta", type=float, default=4.0,
                    help="порог прореживания ключевых кадров, °")
    ap.add_argument("--out", type=Path, help="куда писать клип (JSON)")
    ap.add_argument("--merge", type=Path,
                    help="вписать глосс прямо в avatar/native_lexicon.json")
    ap.add_argument("--self-test", action="store_true",
                    help="проверить математику ретаргета и выйти")
    args = ap.parse_args()

    if args.self_test:
        self_test()
        return
    if not args.video or not args.gloss:
        ap.error("нужны видео и --gloss (или --self-test)")

    frames = thin_keyframes(
        extract_clip(args.video, args.fps, args.start, args.end,
                     args.hands, args.mirror),
        args.min_delta)
    clip: dict = {"frames": frames, "hold": args.hold}
    if args.ru:
        clip["ru"] = args.ru
    if args.aliases:
        clip["aliases"] = [a.strip() for a in args.aliases.split(",") if a.strip()]

    print(f"Кадров после прореживания: {len(frames)} "
          f"(длительность {frames[-1]['t']} мс)")

    if args.merge:
        lex = json.loads(args.merge.read_text(encoding="utf-8"))
        lex.setdefault("glosses", {})[args.gloss] = clip
        args.merge.write_text(json.dumps(lex, ensure_ascii=False, indent=2) + "\n",
                              encoding="utf-8")
        print(f"Глосс «{args.gloss}» записан в {args.merge}")
    out = args.out or Path(f"{args.gloss}.clip.json")
    if args.out or not args.merge:
        out.write_text(json.dumps({args.gloss: clip}, ensure_ascii=False, indent=2)
                       + "\n", encoding="utf-8")
        print(f"Клип сохранён: {out}")
    print("Дальше: проверьте жест во вкладке «Глоссы» Аватар-лаба и при "
          "необходимости поправьте tw/rot/wr — монокулярная оценка этих углов "
          "приблизительная.")


if __name__ == "__main__":
    main()
