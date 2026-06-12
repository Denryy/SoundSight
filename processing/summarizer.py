"""
Extractive summarizer — fully offline, no API keys required.

Algorithm:
  1. Split transcript into sentences.
  2. Score each sentence by keyword frequency (TF-style).
  3. Pick top-N sentences in original order.
  4. Return structured text block.
"""

import re
from datetime import datetime
from typing import Optional

from processing.structurer import extract_keywords


def _split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [s.strip() for s in parts if len(s.strip()) > 10]


def _normalize(sentence: str) -> str:
    """Ключ для дедупликации: схлопнутые пробелы, нижний регистр, без пунктуации."""
    return re.sub(r"[^\wа-яёa-z]+", " ", sentence.lower()).strip()


def _dedupe(sentences: list[str]) -> list[str]:
    """Убирает повторы и почти-повторы (live-ASR часто переотправляет фразу)."""
    seen: set[str] = set()
    out: list[str] = []
    for s in sentences:
        key = _normalize(s)
        if not key or key in seen:
            continue
        # Поглощение: пропускаем строку, если она целиком входит в уже принятую
        # (или наоборот) — типичный артефакт растущего interim → final.
        if any(key in prev or prev in key for prev in seen):
            continue
        seen.add(key)
        out.append(s)
    return out


def _score_sentences(sentences: list[str], keywords: list[str]) -> list[tuple[int, float]]:
    kw_set = set(keywords)
    scored: list[tuple[int, float]] = []
    for idx, sentence in enumerate(sentences):
        words = re.findall(r"\b[а-яёА-ЯЁa-zA-Z]+\b", sentence.lower())
        hits = sum(1 for w in words if w in kw_set)
        # Нормируем на длину, но штрафуем совсем короткие обрывки (мало сигнала).
        length_factor = min(len(words), 12) / 12
        score = (hits / max(len(words), 1)) * length_factor
        scored.append((idx, score))
    return scored


def generate_summary(transcript: str, top_n: int = 5) -> str:
    if not transcript.strip():
        return "Транскрипт пустой."

    sentences = _dedupe(_split_sentences(transcript))
    if not sentences:
        return transcript[:500]

    keywords = extract_keywords(transcript, max_keywords=20)

    # Короткая сессия: резюмировать нечего — отдаём очищенный транскрипт целиком.
    if len(sentences) <= top_n:
        body = " ".join(sentences)
        kw_line = ", ".join(keywords[:8]) if keywords else "—"
        return f"Ключевые темы: {kw_line}.\n\n{body}"

    scored = _score_sentences(sentences, keywords)
    top_indices = sorted(
        sorted(scored, key=lambda x: x[1], reverse=True)[:top_n],
        key=lambda x: x[0],
    )
    top_sentences = [sentences[i] for i, _ in top_indices]

    kw_line = ", ".join(keywords[:8]) if keywords else "—"
    summary_body = " ".join(top_sentences)

    return f"Ключевые темы: {kw_line}.\n\n{summary_body}"


async def build_session_meta(
    transcript: str, started_at: Optional[datetime] = None
) -> tuple[str, str]:
    """Return (title, summary) for a finished session.

    Uses the LLM (e.g. Gemini) when SOUNDSIGHT_ENABLE_LLM=true and the call succeeds;
    otherwise falls back to the offline extractive title + summary. Imported
    lazily so the offline path never needs the LLM module.

    The summary keeps the "Ключевые темы: …" first line that the History and
    Summary screens render, regardless of which path produced it.
    """
    from agent import llm_refiner

    if llm_refiner.is_enabled():
        data = await llm_refiner.summarize_session(transcript)
        if data:
            title = data["title"] or derive_title(transcript, started_at)
            topics = data["topics"] or extract_keywords(transcript, max_keywords=8)
            body = data["summary"] or generate_summary(transcript)
            kw_line = ", ".join(topics[:8]) if topics else "—"
            return title[:90], f"Ключевые темы: {kw_line}.\n\n{body}"

    return derive_title(transcript, started_at), generate_summary(transcript)


def derive_title(transcript: str, started_at: Optional[datetime] = None) -> str:
    """Краткий заголовок сессии для истории: первые значимые слова транскрипта,
    иначе — ключевые слова, иначе — дата."""
    text = transcript.strip()
    if not text:
        if started_at:
            return f"Сессия от {started_at:%d.%m.%Y %H:%M}"
        return "Пустая сессия"

    sentences = _split_sentences(text)
    base = sentences[0] if sentences else text
    words = base.split()
    title = " ".join(words[:8])
    if len(words) > 8:
        title += "…"
    title = title.strip()

    if len(title) < 4:
        kws = extract_keywords(text, max_keywords=3)
        if kws:
            return "Лекция: " + ", ".join(kws)
    return title[:90]
