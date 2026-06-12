"""
Optional LLM refinement layer for the SoundSight agent pipeline.

Activated only when SOUNDSIGHT_ENABLE_LLM=true is set in environment.
Uses any OpenAI-compatible HTTP API (OpenAI, local llama.cpp, Ollama, etc.)
with a simple httpx-based client — no openai SDK required.

Architecture position:
    ASR → structuring → agent policy → [LLM refiner] → outputs

The refiner does NOT replace agent policy. It runs after routing decisions
are made and can:
  - Rewrite raw transcript into cleaner, more accessible text
  - Condense long speech blocks (>20 words) into concise summaries
  - Generate structured notes from topic-ending blocks

If LLM is unavailable, times out, or returns an error, the original
text passes through unchanged. Offline mode is always preserved.
"""

import json
import logging
import os
import time
from typing import Optional
from urllib.parse import urlparse

logger = logging.getLogger("soundsight.llm")

# ---------------------------------------------------------------------------
# Configuration from environment
# ---------------------------------------------------------------------------

_ENABLED: bool = os.getenv("SOUNDSIGHT_ENABLE_LLM", "false").lower() == "true"
_PROVIDER: str = os.getenv("SOUNDSIGHT_LLM_PROVIDER", "openai_compatible")
_MODEL: str = os.getenv("SOUNDSIGHT_LLM_MODEL", "gpt-4o-mini")
_BASE_URL: str = os.getenv("SOUNDSIGHT_LLM_BASE_URL", "https://api.openai.com/v1")
_API_KEY: str = os.getenv("SOUNDSIGHT_LLM_API_KEY", "")
_TIMEOUT: float = float(os.getenv("SOUNDSIGHT_LLM_TIMEOUT", "5.0"))
_MAX_TOKENS: int = int(os.getenv("SOUNDSIGHT_LLM_MAX_TOKENS", "120"))

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

_REFINE_PROMPT = (
    "Ты — ассистент субтитров для людей с нарушением слуха. Очисти фрагмент "
    "распознанной речи: убери слова-паразиты и оговорки, поправь явные ошибки "
    "распознавания и пунктуацию.\n"
    "ЖЁСТКИЕ ПРАВИЛА:\n"
    "- НЕ переводи: сохрани ИСХОДНЫЙ ЯЗЫК фрагмента (русский остаётся русским, "
    "английский — английским, казахский — казахским).\n"
    "- НЕ сокращай и не выкидывай смысл — сохрани ВСЕ факты и детали.\n"
    "- Верни только исправленный текст, без пояснений и кавычек.\n\n"
    "Фрагмент: {text}"
)

_CONDENSE_PROMPT = (
    "Ты — ассистент субтитров для людей с нарушением слуха. Приведи блок "
    "распознанной речи к читаемому виду для субтитров: убери слова-паразиты, "
    "повторы и оговорки, расставь пунктуацию.\n"
    "ЖЁСТКИЕ ПРАВИЛА:\n"
    "- НЕ переводи: сохрани ИСХОДНЫЙ ЯЗЫК блока.\n"
    "- Сохрани ВСЮ ключевую информацию — не теряй факты.\n"
    "- Верни только итоговый текст, без пояснений и кавычек.\n\n"
    "Блок: {text}"
)

_STRUCTURED_NOTE_PROMPT = (
    "You are an accessibility assistant helping hearing-impaired students. "
    "Extract a short structured note (1-3 bullet points) from this lecture segment. "
    "Output only the bullet points.\n\n"
    "Segment: {text}"
)

_SESSION_SUMMARY_PROMPT = (
    "Ты — ассистент для студентов с нарушением слуха. Ниже — транскрипт лекции, "
    "распознанный из речи (возможны оговорки, повторы и слова-паразиты). "
    "Проанализируй СОДЕРЖАНИЕ и верни результат на русском языке.\n"
    "Сделай:\n"
    "1. title — краткий осмысленный заголовок темы (3–7 слов, без вводных слов "
    "и слов-паразитов);\n"
    "2. topics — список из 3–6 ключевых тем (короткие словосочетания);\n"
    "3. summary — связное резюме лекции в 2–4 предложениях.\n"
    "Верни СТРОГО валидный JSON без markdown-обёртки и без пояснений:\n"
    '{{"title": "...", "topics": ["...", "..."], "summary": "..."}}\n\n'
    "Транскрипт:\n{text}"
)

# Session summaries need more output room than short live segments, and gemini-2.5
# "thinking" models spend part of the token budget on hidden reasoning — so give
# this call a higher ceiling than the latency-tuned live default.
_SUMMARY_MAX_TOKENS: int = max(_MAX_TOKENS, 1500)
# Cap transcript length sent to the model to bound cost/latency on long lectures.
_SUMMARY_INPUT_LIMIT: int = 6000


# ---------------------------------------------------------------------------
# HTTP client (no openai SDK dependency)
# ---------------------------------------------------------------------------

async def _call_llm(prompt: str, max_tokens: Optional[int] = None) -> Optional[str]:
    """
    Send a single-turn chat completion request to an OpenAI-compatible API.
    Returns the response text or None on any failure.

    max_tokens overrides the default per-call ceiling — session summaries need
    more room than short live segments (and "thinking" models spend part of the
    budget on hidden reasoning).
    """
    if not _API_KEY:
        logger.warning("SOUNDSIGHT_LLM_API_KEY not set — skipping LLM call")
        return None

    try:
        import httpx
    except ImportError:
        logger.warning("httpx not installed — LLM calls disabled. uv sync (or uv pip install httpx)")
        return None

    if urlparse(_BASE_URL).scheme not in ("http", "https"):
        logger.warning("SOUNDSIGHT_LLM_BASE_URL must be http(s) — skipping LLM call")
        return None

    url = f"{_BASE_URL.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {_API_KEY}",
        "Content-Type": "application/json",
    }
    body = {
        "model": _MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens or _MAX_TOKENS,
        "temperature": 0.3,
    }

    try:
        # follow_redirects=False: a redirect to an internal host would leak the
        # bearer token / transcript (SSRF). Fail closed instead.
        async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False) as client:
            resp = await client.post(url, headers=headers, json=body)
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        logger.warning("LLM call failed (%s: %s) — falling back to original text", type(e).__name__, e)
        return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def refine_text(text: str) -> str:
    """
    Rewrite a short segment into clean accessible text.
    Falls back to original text if LLM is disabled or fails.
    """
    if not _ENABLED:
        return text
    t0 = time.monotonic()
    result = await _call_llm(_REFINE_PROMPT.format(text=text))
    elapsed = (time.monotonic() - t0) * 1000
    if result:
        logger.info("refine OK %.0fms | %r → %r", elapsed, text[:40], result[:40])
        return result
    return text


async def condense_block(text: str) -> str:
    """
    Condense a long speech block (>20 words) into 1-2 sentences.
    Falls back to original text if LLM is disabled or fails.
    """
    if not _ENABLED:
        return text
    t0 = time.monotonic()
    result = await _call_llm(_CONDENSE_PROMPT.format(text=text))
    elapsed = (time.monotonic() - t0) * 1000
    if result:
        logger.info("condense OK %.0fms | len=%d → %d chars", elapsed, len(text), len(result))
        return result
    return text


async def generate_structured_note(text: str) -> Optional[str]:
    """
    Generate bullet-point structured notes from a topic-ending segment.
    Returns None if LLM is disabled or fails (caller uses extractive summary instead).
    """
    if not _ENABLED:
        return None
    result = await _call_llm(_STRUCTURED_NOTE_PROMPT.format(text=text))
    return result


def _strip_code_fence(raw: str) -> str:
    """Drop a leading ```json / ``` fence and trailing ``` if the model wrapped
    its JSON despite being asked not to."""
    s = raw.strip()
    if s.startswith("```"):
        s = s[3:]
        if s[:4].lower() == "json":
            s = s[4:]
        if s.endswith("```"):
            s = s[:-3]
    return s.strip()


async def summarize_session(transcript: str) -> Optional[dict]:
    """
    Produce a structured session summary {title, topics, summary} via the LLM.

    Returns None when LLM is disabled, the transcript is empty, the API fails,
    or the response is not valid JSON — callers then fall back to the offline
    extractive summarizer.
    """
    if not _ENABLED:
        return None
    text = transcript.strip()
    if not text:
        return None

    raw = await _call_llm(
        _SESSION_SUMMARY_PROMPT.format(text=text[:_SUMMARY_INPUT_LIMIT]),
        max_tokens=_SUMMARY_MAX_TOKENS,
    )
    if not raw:
        return None

    try:
        data = json.loads(_strip_code_fence(raw))
    except (ValueError, TypeError):
        logger.warning("LLM session summary was not valid JSON — falling back to offline")
        return None
    if not isinstance(data, dict):
        return None

    title = str(data.get("title", "")).strip()
    topics = [str(t).strip() for t in data.get("topics", []) if str(t).strip()]
    summary = str(data.get("summary", "")).strip()
    if not summary and not title:
        return None
    return {"title": title, "topics": topics, "summary": summary}


def is_enabled() -> bool:
    """Return True when LLM refinement is active."""
    return _ENABLED


def status() -> dict:
    """Return current LLM configuration for observability endpoint."""
    return {
        "enabled": _ENABLED,
        "provider": _PROVIDER if _ENABLED else None,
        "model": _MODEL if _ENABLED else None,
        "base_url": _BASE_URL if _ENABLED else None,
        "timeout_sec": _TIMEOUT,
        "max_tokens": _MAX_TOKENS,
    }
