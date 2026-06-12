"""
Тесты pose-track синтеза собственного 3D-аватара (avatar/pose_synthesis.py).

Запуск: pytest tests/test_native_avatar.py
Без torch/whisper — импортируется только лёгкая часть avatar/.
"""

import json
from pathlib import Path

import pytest

from avatar import pose_synthesis as ps
from avatar.synthesis import avatar_engine


def _kinds(track: dict) -> list[str]:
    return [s["kind"] for s in track["signs"]]


# ── Маршрутизация ────────────────────────────────────────────────────────────

def test_known_gloss_routes_to_gloss():
    track = ps.build_pose_track("hello world", "hello world")
    assert track is not None and track["v"] == 1
    glosses = [s for s in track["signs"] if s["kind"] == "gloss"]
    assert glosses and glosses[0]["id"] == "hello"


def test_alias_maps_to_canonical_gloss():
    track = ps.build_pose_track("hi", "hi")
    glosses = [s for s in track["signs"] if s["kind"] == "gloss"]
    assert glosses and glosses[0]["id"] == "hello"


def test_unknown_word_is_fingerspelled():
    track = ps.build_pose_track("xylophone", "xylophone")
    spells = [s for s in track["signs"] if s["kind"] == "spell"]
    assert spells and spells[0]["alphabet"] == "asl"
    assert "".join(spells[0]["letters"]) == "xylophone"


def test_gap_between_words():
    track = ps.build_pose_track("hello question", "hello question")
    assert "gap" in _kinds(track)


def test_stopwords_only_falls_back_to_spelling():
    # Все слова в _SKIP → hybrid пуст, но сегмент не должен быть «немым».
    track = ps.build_pose_track("the and for", "the and for")
    assert track is not None
    assert any(s["kind"] == "spell" for s in track["signs"])


def test_empty_text_returns_none():
    assert ps.build_pose_track("", "") is None


# ── Лимиты ───────────────────────────────────────────────────────────────────

def test_letter_cap_respected():
    long_word = "a" * 200
    track = ps.build_pose_track(long_word, long_word)
    total_letters = sum(
        len(s["letters"]) for s in track["signs"] if s["kind"] == "spell"
    )
    assert total_letters <= ps._MAX_LETTERS


def test_word_cap_respected():
    text = "hello " * 30
    track = ps.build_pose_track(text, text)
    glosses = [s for s in track["signs"] if s["kind"] == "gloss"]
    assert len(glosses) <= ps._MAX_WORDS


# ── Режим ru_dactyl ──────────────────────────────────────────────────────────

def test_ru_dactyl_spells_cyrillic_source(monkeypatch):
    from core.config import config
    monkeypatch.setattr(config, "SIGN_LANG", "ru_dactyl")
    track = ps.build_pose_track("привет мир", "hello world")
    spells = [s for s in track["signs"] if s["kind"] == "spell"]
    assert spells and all(s["alphabet"] == "ru" for s in spells)
    assert "".join(spells[0]["letters"]) == "привет"


# ── Лексикон как единый источник правды ──────────────────────────────────────

def test_lexicon_file_is_valid_and_indexed():
    path = Path(ps.__file__).parent / "native_lexicon.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["glosses"], "лексикон пуст"
    for gloss_id, entry in data["glosses"].items():
        assert entry["frames"], f"{gloss_id}: нет кадров"
        ts = [f["t"] for f in entry["frames"]]
        assert ts == sorted(ts), f"{gloss_id}: кадры не по времени"
        assert ps.native_gloss(gloss_id) == gloss_id


# ── Интеграция с SignAvatarEngine ────────────────────────────────────────────

def test_synthesize_carries_pose_track():
    frame = avatar_engine.synthesize("hello")
    assert frame.pose is not None
    assert frame.pose["v"] == 1
    assert any(s["kind"] == "gloss" for s in frame.pose["signs"])


def test_cyrillic_without_translator_falls_back_to_ru_dactyl():
    # en_text == исходной кириллице (перевод не сработал) → русский дактиль.
    track = ps.build_pose_track("привет", "привет")
    assert track is not None
    spells = [s for s in track["signs"] if s["kind"] == "spell"]
    assert spells and spells[0]["alphabet"] == "ru"
