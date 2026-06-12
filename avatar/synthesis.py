"""
Avatar / Sign Language Synthesis module.
Translates RU/KZ -> EN, then maps to SiGML for CWASA.

Sign modes (core.config.SIGN_LANG):
  "hybrid" (default) — per content word: a real lexical ISL sign when one
                       exists, otherwise fingerspell it. Distinct, varied,
                       meaningful — avoids the "same handshapes every segment"
                       look of pure fingerspelling.
  "asl"              — fingerspell only (full coverage, uniform look).
  "isl"              — bundled lexical dictionary only (varied but sparse).
"""

import os
import re
from dataclasses import dataclass

from core.config import config
from avatar.sigml_lookup import text_to_sigml, lexical_sign
from avatar.asl_fingerspell import text_to_asl, fingerspell, _SKIP

_WORD_RE = re.compile(r"[a-z]+")
# How much of each segment the avatar signs. Higher = more coverage but the
# avatar lags further behind live speech (fingerspelling is slow). Tunable via
# .env without a code change.
_MAX_WORDS = int(os.getenv("AVATAR_MAX_WORDS", "8"))      # content words signed per segment
_MAX_LETTERS = int(os.getenv("AVATAR_MAX_LETTERS", "24"))  # cap on fingerspelled letters per segment


@dataclass
class AvatarFrame:
    text: str
    sigml: str | None
    url: str
    duration_ms: int
    # Pose-track для СВОЕГО 3D-аватара (avatar/pose_synthesis.py). Строится
    # параллельно SiGML — фронтенд сам выбирает движок (native | CWASA).
    pose: dict | None = None


def _hybrid_signs(en_text: str) -> list[str]:
    """Per content word: a real lexical sign if available, else fingerspell it.

    Lexical signs are whole-body movements and read as distinct gestures;
    fingerspelling everything looks the same segment to segment. Preferring
    lexical signs and spelling only the remainder yields varied, meaningful
    output.
    """
    words = [
        w for w in _WORD_RE.findall(en_text.lower())
        if len(w) >= 2 and w not in _SKIP
    ]
    signs: list[str] = []
    spelled = 0
    for w in words[:_MAX_WORDS]:
        lex = lexical_sign(w)
        if lex:
            signs.append(lex)
        elif spelled < _MAX_LETTERS:
            take = fingerspell(w)[: _MAX_LETTERS - spelled]
            signs.extend(take)
            spelled += len(take)
    return signs


def _build_sigml(text: str, en_text: str) -> str | None:
    mode = config.SIGN_LANG
    if mode == "isl":
        return text_to_sigml(en_text) or None
    if mode == "asl":
        return text_to_asl(en_text) or None
    # default: hybrid
    signs = _hybrid_signs(en_text)
    if not signs:
        # Fall back to fingerspelling so a content segment is never silent.
        return text_to_asl(en_text) or None
    return f'<sigml>{"".join(signs)}</sigml>'


class SignAvatarEngine:
    AVATAR_PLACEHOLDER = "/static/avatar_placeholder.gif"

    def synthesize(self, text: str) -> AvatarFrame:
        # Translate to EN for maximum sign coverage.
        try:
            from avatar.translator import translate_to_en
            en_text = translate_to_en(text)
        except Exception:
            en_text = text

        sigml = _build_sigml(text, en_text)

        # Свой 3D-аватар: pose-track строится всегда (дёшево, без перевода —
        # en_text уже посчитан). Ошибка здесь не должна ломать SiGML-ветку.
        try:
            from avatar.pose_synthesis import build_pose_track
            pose = build_pose_track(text, en_text)
        except Exception:
            pose = None

        duration_ms = max(1000, len(text.split()) * 500)
        return AvatarFrame(
            text=text,
            sigml=sigml,
            url=self.AVATAR_PLACEHOLDER,
            duration_ms=duration_ms,
            pose=pose,
        )


avatar_engine = SignAvatarEngine()
