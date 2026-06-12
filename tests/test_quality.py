"""
Regression tests for the post-feedback quality fixes:
  - processing.structurer.extract_keywords: drops filler, merges word forms
  - avatar.synthesis._hybrid_signs: prefers lexical signs, fingerspells the rest
  - asr.whisper_engine.transcribe_raw: accepts the fast/greedy interim flag
"""

import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from processing.structurer import extract_keywords, _stem
from avatar.synthesis import _hybrid_signs


# ---------------------------------------------------------------------------
# Keyword extraction
# ---------------------------------------------------------------------------

_TRANSCRIPT = (
    "Фактически наша экономика в некотором смысле построена на захвате внимания. "
    "Информация поглощает наше внимание. Обилие информации порождает бедность внимания."
)


def test_keywords_drop_filler_words():
    kws = extract_keywords(_TRANSCRIPT, max_keywords=8)
    junk = {"когда", "фактически", "наша", "некотором", "смысле", "построена"}
    assert junk.isdisjoint(kws), f"filler leaked into keywords: {junk & set(kws)}"


def test_keywords_surface_real_topics_first():
    kws = extract_keywords(_TRANSCRIPT, max_keywords=5)
    # "внимание" appears most (3x across forms) → must rank first.
    assert kws[0].startswith("внимани"), kws
    assert any(k.startswith("информаци") for k in kws), kws


def test_keyword_forms_are_merged():
    # внимание / внимания / внимание share a stem → counted once, not three slots.
    kws = extract_keywords("внимание внимания внимание информация", max_keywords=10)
    attention = [k for k in kws if k.startswith("внимани")]
    assert len(attention) == 1, f"forms not merged: {attention}"


def test_stem_groups_russian_forms():
    assert _stem("внимания") == _stem("внимание")
    assert _stem("информации") == _stem("информация")


def test_keywords_empty_text():
    assert extract_keywords("", 5) == []


# ---------------------------------------------------------------------------
# Hybrid avatar signs
# ---------------------------------------------------------------------------

def _glosses(signs: list[str]) -> list[str]:
    return [m.group(1) for s in signs if (m := re.search(r'gloss="([^"]+)"', s))]


def test_hybrid_prefers_lexical_signs():
    # "school" and "come" exist in the lexical dictionary → real signs, no spelling.
    signs = _hybrid_signs("come to school")
    gl = _glosses(signs)
    assert "come" in gl and "school" in gl
    assert not any(g.startswith("-") for g in gl), "should not fingerspell known words"


def test_hybrid_fingerspells_unknown_words():
    # "cold" is not a lexical sign → fingerspelled as -c--o--l--d-.
    signs = _hybrid_signs("cold")
    gl = _glosses(signs)
    assert gl == ["-c-", "-o-", "-l-", "-d-"], gl


def test_hybrid_skips_function_words():
    # "the / is" are function words → skipped; only "water" (lexical) remains.
    signs = _hybrid_signs("the water is")
    gl = _glosses(signs)
    assert gl == ["water"], gl


def test_hybrid_empty_for_no_content():
    assert _hybrid_signs("the is and of") == []


# ---------------------------------------------------------------------------
# ASR fast/greedy interim flag
# ---------------------------------------------------------------------------

def test_transcribe_raw_accepts_fast_flag():
    import inspect
    from asr.whisper_engine import WhisperEngine
    sig = inspect.signature(WhisperEngine.transcribe_raw)
    assert "fast" in sig.parameters
    assert sig.parameters["fast"].default is False
