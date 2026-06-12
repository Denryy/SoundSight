"""
Lightweight keyword / topic extraction for transcript chunks.

Offline, no external NLP deps. Two quality measures over naive frequency:
  1. A much larger Russian stop-list (pronouns, adverbs, intro words, common
     verbs) on top of the shared lexicon stopwords, so filler like
     "когда / фактически / наша / некотором / смысле / построена" never surfaces
     as a topic.
  2. Crude inflection stripping so word forms of the same lemma
     ("внимание / внимания / вниманию") are counted together and ranked once.

This stop-list is intentionally kept *separate* from core.lexicon.STOPWORDS:
the agent policy uses that set to count "meaningful words", and bloating it
would change routing decisions. Keyword extraction can afford to be stricter.
"""

import re

from core.lexicon import STOPWORDS

# Extra high-frequency Russian words that carry no topical meaning. Added on top
# of the shared STOPWORDS set used by the agent policy.
_EXTRA_STOPWORDS: set[str] = {
    # pronouns / possessives
    "наша", "наше", "наш", "наши", "ваша", "ваше", "ваш", "ваши",
    "моя", "моё", "мой", "мои", "твоя", "твоё", "твой", "твои",
    "свой", "своя", "своё", "свои", "себя", "себе", "собой",
    "этот", "эта", "это", "эти", "этого", "этой", "этих", "этом",
    "тот", "та", "те", "того", "той", "тех", "том",
    "который", "которая", "которое", "которые", "которых", "котором",
    "весь", "вся", "всё", "все", "всех", "всем", "всеми", "всего",
    "сам", "сама", "само", "сами", "самый", "самая", "самое",
    "каждый", "каждая", "любой", "любая", "некоторый", "некотором",
    "некоторые", "такой", "такая", "такое", "такие",
    "нам", "нас", "вам", "вас", "них", "ним", "ему", "ней", "нему",
    # adverbs / intro / discourse
    "когда", "тогда", "сейчас", "теперь", "потом", "затем", "сначала",
    "здесь", "там", "тут", "где", "куда", "откуда", "почему", "зачем",
    "очень", "более", "менее", "много", "мало", "немного", "совсем",
    "тоже", "также", "поэтому", "следовательно", "значит", "итак",
    "однако", "впрочем", "причём", "притом", "просто", "лишь", "даже",
    "именно", "точно", "конечно", "наверное", "возможно", "вероятно",
    "всегда", "никогда", "иногда", "часто", "редко", "обычно",
    "например", "фактически", "практически", "действительно",
    "вообще", "кстати", "напротив", "наоборот", "якобы", "будто",
    "образом", "таким", "помощью", "течение", "время", "момент",
    "чтобы", "если", "хотя", "пока", "ведь", "разве", "неужели",
    "смысл", "смысле", "смысла", "роль", "рамках", "основном", "основе",
    "сути", "связи", "виде", "счёт", "счет", "стороны", "сторону",
    # common light verbs / copulas
    "является", "являются", "был", "была", "было", "были", "будет",
    "будут", "есть", "стал", "стала", "стали", "может", "можно",
    "нужно", "надо", "должен", "должна", "должны", "делать", "сделать",
    "думаю", "думать", "считаю", "говорит", "говорил", "сказал",
    "хочу", "хотим", "хотят", "знаю", "знаем", "видим", "видеть",
    "построена", "построен", "построено", "вступили", "грозит",
    # English filler beyond shared set
    "have", "has", "had", "will", "would", "could", "should", "about",
    "there", "their", "them", "then", "than", "which", "what", "when",
    "where", "your", "you", "our", "very", "just", "into", "from",
    "they", "been", "being", "also", "such", "some", "more", "most",
}

_KEYWORD_STOPWORDS: set[str] = set(STOPWORDS) | _EXTRA_STOPWORDS

# Russian *inflectional* case/number endings only (no derivational suffixes like
# "-ость"/"-ение", which would strip inconsistently between forms of one lemma).
# Stripped iteratively, longest match first, so "внимание" and "внимания" both
# reduce to the same stem "вниман". Heuristic, not a real morphological analyzer.
_RU_ENDINGS: tuple[str, ...] = tuple(sorted({
    "ого", "его", "ому", "ему", "ыми", "ими",
    "ах", "ях", "ам", "ям", "ов", "ев", "ие", "ия", "ию", "ей", "ой",
    "ый", "ий", "ая", "яя", "ую", "юю", "ью", "ом", "ем", "их", "ых",
    "им", "ым", "ыя",
    "а", "я", "и", "ы", "о", "у", "е", "ь", "й",
}, key=len, reverse=True))

_MIN_STEM_LEN = 4
_WORD_RE = re.compile(r"\b[а-яёА-ЯЁa-zA-Z]{4,}\b")
_HAS_CYRILLIC = re.compile(r"[а-яёА-ЯЁ]")


def _stem(word: str) -> str:
    """Crude stem: iteratively strip Russian inflectional endings while the
    remainder stays at least _MIN_STEM_LEN long. Latin words pass through."""
    if not _HAS_CYRILLIC.search(word):
        return word
    stem = word
    stripping = True
    while stripping:
        stripping = False
        for ending in _RU_ENDINGS:
            if (
                len(ending) < len(stem)
                and stem.endswith(ending)
                and len(stem) - len(ending) >= _MIN_STEM_LEN
            ):
                stem = stem[: -len(ending)]
                stripping = True
                break
    return stem


def extract_keywords(text: str, max_keywords: int = 10) -> list[str]:
    """Frequency-ranked keywords with stop-word filtering and form grouping.

    Word forms sharing a crude stem are counted together; the most frequent
    (then longest) surface form represents the group.
    """
    words = _WORD_RE.findall(text.lower())

    groups: dict[str, dict] = {}
    for word in words:
        if word in _KEYWORD_STOPWORDS:
            continue
        stem = _stem(word)
        group = groups.setdefault(stem, {"count": 0, "forms": {}})
        group["count"] += 1
        group["forms"][word] = group["forms"].get(word, 0) + 1

    # Rank groups by total frequency, then by stem length (prefer contentful words).
    ranked = sorted(groups.items(), key=lambda kv: (-kv[1]["count"], -len(kv[0])))

    keywords: list[str] = []
    for _stem_key, group in ranked:
        # Representative surface form: most frequent, tie-broken by length.
        rep = sorted(group["forms"].items(), key=lambda kv: (-kv[1], -len(kv[0])))[0][0]
        keywords.append(rep)
        if len(keywords) >= max_keywords:
            break
    return keywords


def structure_chunk(text: str) -> dict:
    """Return enriched metadata for a transcript chunk."""
    return {
        "text": text,
        "keywords": extract_keywords(text, max_keywords=5),
        "word_count": len(text.split()),
    }
