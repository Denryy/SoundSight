"""
ASL fingerspelling → SiGML.

Generates Signing Gesture Markup Language (the same XML the existing CWASA
avatar already renders) for the American manual alphabet, so any word can be
spelled letter-by-letter when no lexical sign exists.

Pipeline position:
    ASR → translate RU/KZ → EN → fingerspell key words → SiGML → CWASA

Each letter is one HamNoSys handshape held in neutral fingerspelling space.
The handshapes below are a first-pass mapping of the standard ASL alphabet to
HamNoSys primitives that this CWASA build is known to accept (every token used
here also appears in the bundled ISL sign set). They are easy to tune one line
at a time after watching the avatar — see tools/preview.

Letters J and Z carry the small movement that distinguishes them.
"""

import re

# Orientation fragments (right hand). Varying these per letter — not just the
# handshape — is what makes the letters visually distinct on the avatar.
_UP = "<hamextfingeru/><hampalml/>"     # fingers up, palm facing addressee
_UP_D = "<hamextfingeru/><hampalmd/>"   # fingers up, palm rotated
_FWD = "<hamextfingero/><hampalmd/>"    # fingers pointing forward/away
_DOWN = "<hamextfingerd/><hampalml/>"   # fingers pointing down

# ASL manual alphabet in HamNoSys, built only from tokens that appear in the
# bundled validated sign set (so every letter parses and animates).
_LETTERS: dict[str, str] = {
    "a": f"<hamfist/><hamthumbopenmod/>{_UP}",
    "b": f"<hamflathand/><hamthumbacrossmod/>{_UP}",
    "c": f"<hamceeall/>{_UP_D}",
    "d": f"<hamfinger2/><hamfingerstraightmod/><hamthumbacrossmod/>{_UP}",
    "e": f"<hamfinger2345/><hamfingerbendmod/><hamthumbacrossmod/>{_UP}",
    "f": f"<hampinchopen/>{_UP}",
    "g": f"<hamfinger2/><hamthumbopenmod/>{_FWD}",
    "h": f"<hamfinger23/><hamthumbacrossmod/>{_FWD}",
    "i": f"<hampinky/><hamfingerstraightmod/>{_UP}",
    "j": f"<hampinky/><hamfingerstraightmod/>{_UP}<hammoved/><hamarcu/>",
    "k": f"<hamfinger23spread/><hamthumbopenmod/>{_UP}",
    "l": f"<hamfinger2/><hamthumbopenmod/>{_UP_D}",
    "m": f"<hamfinger2345/><hamthumbacrossmod/><hamfingerbendmod/>{_DOWN}",
    "n": f"<hamfinger23/><hamthumbacrossmod/><hamfingerbendmod/>{_DOWN}",
    "o": f"<hampinchall/>{_UP}",
    "p": f"<hamfinger23spread/><hamthumbopenmod/>{_FWD}",
    "q": f"<hamfinger2/><hamthumbopenmod/><hamextfingerd/><hampalmd/>",
    "r": f"<hamfinger23/><hamthumbopenmod/>{_UP_D}",
    "s": f"<hamfist/><hamthumbacrossmod/>{_UP}",
    "t": f"<hamfist/><hamthumbside/>{_UP}",
    "u": f"<hamfinger23/><hamfingerstraightmod/>{_UP}",
    "v": f"<hamfinger23spread/>{_UP}",
    "w": f"<hamfinger2345/><hamthumbacrossmod/><hamfingerstraightmod/>{_UP}",
    "x": f"<hamfinger2/><hamfingerhookmod/>{_UP}",
    "y": f"<hamfist/><hamthumbopenmod/><hampinky/>{_UP}",
    "z": f"<hamfinger2/><hamfingerstraightmod/>{_FWD}<hammovel/><hammoved/><hammovel/>",
}

# How much to fingerspell so the avatar stays in sync with live subtitles.
_MAX_WORDS = 3
_MAX_LETTERS = 14

_WORD_RE = re.compile(r"[a-z]+")

# English function words to skip so we spell meaningful content, not "this is".
_SKIP = {
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "of", "in", "on", "to", "and", "or", "but", "it", "its", "this", "that",
    "these", "those", "with", "for", "we", "you", "they", "he", "she", "i",
    "me", "my", "our", "your", "their", "his", "her", "today", "going",
    "will", "would", "can", "could", "how", "what", "when", "where", "why",
    "here", "there", "now", "then", "so", "as", "at", "by", "from", "do",
    "does", "did", "have", "has", "had", "about", "into", "out", "up", "down",
    "re", "s", "t", "m", "ll", "ve", "let", "us", "hey", "hi", "yes", "no",
}


def _letter_sign(ch: str) -> str:
    body = _LETTERS.get(ch)
    if not body:
        return ""
    return (
        f'<hns_sign gloss="-{ch}-">'
        f"<hamnosys_nonmanual></hamnosys_nonmanual>"
        f"<hamnosys_manual>{body}</hamnosys_manual>"
        f"</hns_sign>"
    )


def fingerspell(word: str) -> list[str]:
    """Return the per-letter SiGML signs for one word (a-z only)."""
    return [s for s in (_letter_sign(ch) for ch in word.lower()) if s]


def has_letters(text: str) -> bool:
    """True when *text* contains at least one spellable latin letter."""
    return bool(_WORD_RE.search(text.lower()))


def text_to_asl(text: str) -> str:
    """
    Fingerspell the leading content words of *text* (already English) as SiGML.

    Caps the output at a couple of words / a dozen letters so the animation
    keeps pace with speech instead of spelling whole sentences.
    Returns "" when nothing spellable is present.
    """
    words = _WORD_RE.findall(text.lower())
    # Prefer meaningful content words; fall back to any words if none qualify.
    content = [w for w in words if len(w) >= 3 and w not in _SKIP]
    words = (content or [w for w in words if len(w) >= 2])[:_MAX_WORDS]

    signs: list[str] = []
    for w in words:
        for s in fingerspell(w):
            if len(signs) >= _MAX_LETTERS:
                break
            signs.append(s)
        if len(signs) >= _MAX_LETTERS:
            break

    if not signs:
        return ""
    return f'<sigml>{"".join(signs)}</sigml>'
