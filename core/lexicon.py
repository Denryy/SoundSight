"""
Shared lexical constants for the agent and processing layers.

Single source of truth for stopwords, ASR hallucination patterns, and filler
words so the pipeline, policy engine, and structurer never drift out of sync.
"""

import re

# ---------------------------------------------------------------------------
# Stopwords (Russian + English, minimal high-frequency set)
# ---------------------------------------------------------------------------

STOPWORDS: set[str] = {
    "и", "в", "на", "с", "по", "из", "для", "это", "что", "как",
    "но", "а", "же", "от", "к", "или", "не", "то", "так", "при",
    "он", "она", "они", "мы", "вы", "я", "его", "её", "их", "был",
    "было", "быть", "вот", "тут", "там", "уже", "ещё", "очень",
    "the", "a", "an", "is", "are", "was", "were", "of", "in", "to",
    "and", "or", "but", "it", "this", "that", "with", "for",
}

# ---------------------------------------------------------------------------
# Known Whisper hallucination / non-speech artefacts
# ---------------------------------------------------------------------------

HALLUCINATION_EXACT: set[str] = {
    "продолжение следует", "субтитры сделаны", "субтитры",
    "thanks for watching", "thank you for watching", "subscribe",
    "да", "нет", "ок", "окей", "хорошо", "ладно",
    "yes", "no", "ok", "okay", "hmm", "uh", "um",
    "music", "музыка", "аплодисменты", "смех",
}

HALLUCINATION_SUBSTR: list[str] = [
    "субтитры создавал", "субтитры сделал", "продолжение следует",
    "dimatzrok", "dimatorzok", "редактор субтитров",
    "динамичная музыка", "бойный стучок",
]

# ---------------------------------------------------------------------------
# Filler / noise words (used by the agent policy to reject empty-content
# segments). Kept here, not in policy.py, so noise filtering stays in one place.
# ---------------------------------------------------------------------------

FILLER_EXACT: set[str] = {
    "да", "нет", "ок", "окей", "хорошо", "ладно", "понятно",
    "yes", "no", "ok", "okay", "hmm", "uh", "um", "ah", "eh",
    "угу", "ага", "эм", "эээ", "ну", "ааа", "ммм",
}

# Words that count as filler when measuring the filler-ratio of a sentence.
FILLER_WORDS: set[str] = FILLER_EXACT | {
    "это", "вот", "как", "бы", "так", "именно",
    "типа", "короче", "значит", "слушай", "слушайте",
}

# If ≥ this share of a sentence's words are filler/stopwords, reject it.
FILLER_RATIO_THRESHOLD = 0.80

FILLER_PATTERNS: list[re.Pattern] = [
    re.compile(r"^[эа-я]{1,3}[\.…,]*$", re.I),   # "эм", "ааа", "ну"
    re.compile(r"^[a-z]{1,3}[\.…,]*$", re.I),     # "um", "uh", "ah"
]
