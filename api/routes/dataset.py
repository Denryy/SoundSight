"""
Gesture-dataset capture routes (Avatar Lab → «Зеркало и запись»).

The browser mirrors the user's gesture onto the native 3D avatar in real time
(frontend-react/src/avatar3d/poseRetarget.ts) and records the pose-contract clip
the avatar actually played. Each take is persisted as ml/dataset/<gloss>/NN.json
in the SAME clip format as ml/extract_pose_clip.py — so the collected takes are
drop-in data for a future text→motion model (see ml/README.md roadmap).

Захват жеста с камеры: фронтенд зеркалит позу на 3D-аватар и записывает клип в
контракте поз — то, что аватар реально повторил. По 10 записей (take) на жест.

Decentralised-config convention: limits are module constants here.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger("soundsight.dataset")

router = APIRouter(prefix="/avatar/dataset", tags=["dataset"])

# Repo root: api/routes/dataset.py → parents[2].
ROOT = Path(__file__).resolve().parents[2]
DATASET_DIR = ROOT / "ml" / "dataset"
MANIFEST_PATH = DATASET_DIR / "manifest.json"

GLOSS_RE = re.compile(r"^[a-z0-9_-]{1,40}$")
MAX_FRAMES = 600        # ~20s @ 30fps — a single sign is far shorter; guards abuse
TARGET_TAKES = 10       # UI collects this many takes per gesture (informational)
MAX_TAKES = 99          # NN.json naming caps at two digits


def _clean_gloss(raw: str) -> str:
    """Normalise and validate a gloss name; raise ValueError if invalid.

    Single validator for all routes. The allowlist (no '.', '/', '\\', or
    absolute paths) is the path-traversal guard — every gloss that reaches the
    filesystem passes through here.
    """
    g = raw.strip().lower()
    if not GLOSS_RE.match(g):
        raise ValueError("gloss must be 1-40 chars of [a-z0-9_-]")
    return g


# ── Schemas ───────────────────────────────────────────────────────────────────
class DatasetFrame(BaseModel):
    t: int = Field(ge=0, le=120_000)  # ms from clip start
    pose: dict

    @field_validator("pose")
    @classmethod
    def _pose_not_empty(cls, v: dict) -> dict:
        if not isinstance(v, dict) or not v:
            raise ValueError("pose must be a non-empty object")
        return v


class DatasetClip(BaseModel):
    frames: list[DatasetFrame] = Field(min_length=1, max_length=MAX_FRAMES)
    hold: int | None = Field(default=None, ge=0, le=5000)


class DatasetClipIn(BaseModel):
    gloss: str
    ru: str | None = Field(default=None, max_length=80)
    clip: DatasetClip

    @field_validator("gloss")
    @classmethod
    def _valid_gloss(cls, v: str) -> str:
        return _clean_gloss(v)


# ── Helpers ───────────────────────────────────────────────────────────────────
def _gloss_dir(gloss: str) -> Path:
    return DATASET_DIR / gloss


def _count_takes(gloss: str) -> int:
    d = _gloss_dir(gloss)
    if not d.is_dir():
        return 0
    return sum(1 for _ in d.glob("[0-9][0-9].json"))


def _read_manifest() -> dict:
    if MANIFEST_PATH.is_file():
        try:
            return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            logger.warning("dataset manifest unreadable — rebuilding", exc_info=True)
    return {"v": 1, "target_takes": TARGET_TAKES, "glosses": {}}


def _write_manifest(man: dict) -> None:
    DATASET_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(
        json.dumps(man, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


# ── Routes ────────────────────────────────────────────────────────────────────
@router.get("")
async def dataset_index() -> dict:
    """Manifest with per-gloss take counts (recomputed from disk) and the target."""
    man = _read_manifest()
    glosses = man.setdefault("glosses", {})
    for gloss, entry in glosses.items():
        entry["takes"] = _count_takes(gloss)
    man["target_takes"] = TARGET_TAKES
    return man


@router.post("/clip")
async def dataset_add_clip(body: DatasetClipIn) -> dict:
    """Persist one recorded take as ml/dataset/<gloss>/NN.json and update the manifest."""
    gloss = body.gloss
    d = _gloss_dir(gloss)

    # Check the limit BEFORE creating the directory so a rejected request leaves
    # no empty gloss folder behind.
    take = _count_takes(gloss) + 1
    if take > MAX_TAKES:
        raise HTTPException(status_code=409, detail=f"take limit ({MAX_TAKES}) reached for '{gloss}'")
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{take:02d}.json"

    record = {
        "gloss": gloss,
        "ru": body.ru or "",
        "take": take,
        "clip": body.clip.model_dump(exclude_none=True),
    }
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    man = _read_manifest()
    entry = man.setdefault("glosses", {}).setdefault(gloss, {})
    if body.ru:
        entry["ru"] = body.ru
    entry["takes"] = _count_takes(gloss)
    _write_manifest(man)

    try:
        rel = str(path.relative_to(ROOT)).replace("\\", "/")
    except ValueError:  # storage relocated outside the repo (e.g. tests)
        rel = str(path).replace("\\", "/")

    logger.info("dataset: saved %s take %d (%d frames)", gloss, take, len(body.clip.frames))
    return {
        "gloss": gloss,
        "take": take,
        "takes": entry["takes"],
        "target": TARGET_TAKES,
        "path": rel,
    }


@router.delete("/{gloss}")
async def dataset_delete(gloss: str) -> dict:
    """Drop all takes for a gloss (re-record from scratch)."""
    try:
        g = _clean_gloss(gloss)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    d = _gloss_dir(g)
    removed = 0
    if d.is_dir():
        for p in d.glob("[0-9][0-9].json"):
            p.unlink()
            removed += 1
        try:
            d.rmdir()
        except OSError:
            pass  # non-empty (stray files) — leave it
    man = _read_manifest()
    man.setdefault("glosses", {}).pop(g, None)
    _write_manifest(man)
    return {"gloss": g, "removed": removed}
