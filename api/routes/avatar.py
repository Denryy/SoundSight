"""
Avatar / sign-language debug routes.

Exposes the SiGML our pipeline generates for an arbitrary text segment so it
can be inspected, or pasted into the UEA CWASA-plus GUI panel
(https://vhg.cmp.uea.ac.uk/tech/jas/vhg2026/CWASA-plus-gui-panel.html) to
verify the animation independently of the live session.
"""

from fastapi import APIRouter, Query
from pydantic import BaseModel

import re

from avatar.synthesis import avatar_engine
from avatar.translator import translate_to_en
from avatar.asl_fingerspell import fingerspell
from avatar.pose_synthesis import LEXICON, build_pose_track

router = APIRouter(prefix="/avatar", tags=["avatar"])

# These debug endpoints translate + synthesise on demand; cap input length so a
# single request can't pin CPU on a huge string.
_MAX_TEXT_LEN = 500


@router.get("/spell")
async def avatar_spell(text: str = Query(..., max_length=_MAX_TEXT_LEN)) -> dict:
    """Raw ASL fingerspelling of *text* (every letter, no content filter).
    For visually checking individual handshapes, e.g. /avatar/spell?text=hello."""
    signs: list[str] = []
    for w in re.findall(r"[a-zA-Z]+", text.lower()):
        signs += fingerspell(w)
    sigml = f'<sigml>{"".join(signs[:40])}</sigml>' if signs else ""
    return {"text": text, "sigml": sigml, "signs": len(signs)}


class AvatarPreview(BaseModel):
    text: str
    translated_en: str
    sigml: str
    has_sign: bool
    duration_ms: int
    # Pose-track собственного 3D-аватара (None, если жестов не вышло).
    pose: dict | None = None


@router.get("/preview", response_model=AvatarPreview)
async def avatar_preview(text: str = Query(..., max_length=_MAX_TEXT_LEN)) -> AvatarPreview:
    """
    Return the SiGML the avatar engine produces for *text*.

    `sigml` is the exact XML sent to CWASA.playSiGMLText() in the browser.
    Copy it into the CWASA-plus GUI panel to see the animation standalone.
    `pose` is the same segment rendered as a native pose-track (see
    docs/native_avatar.md) — exactly what the built-in 3D avatar plays.
    """
    frame = avatar_engine.synthesize(text)
    return AvatarPreview(
        text=text,
        translated_en=translate_to_en(text),
        sigml=frame.sigml or "",
        has_sign=frame.sigml is not None,
        duration_ms=frame.duration_ms,
        pose=frame.pose,
    )


@router.get("/native/lexicon")
async def native_lexicon() -> dict:
    """
    Лексикон собственного 3D-аватара (avatar/native_lexicon.json).

    Единый источник правды: бэкенд маршрутизирует слова по его ключам,
    фронтенд загружает отсюда сами клипы жестов. Добавили жест в JSON —
    он сразу доступен обоим без правки кода.
    """
    return LEXICON


@router.get("/native/pose")
async def native_pose(text: str = Query(..., max_length=_MAX_TEXT_LEN)) -> dict:
    """Pose-track для *text* без полного synthesize() — быстрый дебаг роутинга."""
    en_text = translate_to_en(text)
    track = build_pose_track(text, en_text)
    return {"text": text, "translated_en": en_text, "pose": track}
