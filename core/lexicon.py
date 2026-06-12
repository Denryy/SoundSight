"""
Shared lexical constants for the agent and processing layers.

Single source of truth for stopwords and ASR hallucination patterns so the
pipeline, policy engine, and structurer never drift out of sync.
"""

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
