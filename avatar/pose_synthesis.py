"""
Pose-track synthesis for the NATIVE 3D avatar (свой аватар).

Параллельный SiGML-у формат: вместо XML для внешнего движка CWASA бэкенд
строит компактный JSON-«трек» жестов, который рендерит наш собственный
Three.js-аватар (frontend-react/src/avatar3d/).

Контракт трека (versioned, см. docs/native_avatar.md):

    {
      "v": 1,
      "signs": [
        {"kind": "gloss", "id": "hello"},                       # лексический жест
        {"kind": "spell", "alphabet": "asl", "letters": [...]}, # дактиль
        {"kind": "gap"}                                         # пауза между словами
      ]
    }

Маршрутизация повторяет hybrid-логику SiGML-пайплайна: на каждое значимое
слово — лексический жест, если он есть в avatar/native_lexicon.json, иначе
дактиль. Лимиты AVATAR_MAX_WORDS / AVATAR_MAX_LETTERS общие с SiGML-веткой,
чтобы оба аватара не отставали от живой речи одинаково.

Режим SIGN_LANG=ru_dactyl — дактилирует ИСХОДНЫЙ кириллический текст русской
пальцевой азбукой (формы букв задаются на фронтенде, alphabet="ru"), без
перевода на английский.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

from core.config import config
from avatar.asl_fingerspell import _SKIP

_EN_WORD_RE = re.compile(r"[a-z]+")
_RU_WORD_RE = re.compile(r"[а-яё]+")

# Лимиты — те же env-переменные, что и у SiGML-ветки (avatar/synthesis.py).
_MAX_WORDS = int(os.getenv("AVATAR_MAX_WORDS", "8"))
_MAX_LETTERS = int(os.getenv("AVATAR_MAX_LETTERS", "24"))

_LEXICON_PATH = Path(__file__).parent / "native_lexicon.json"


def _load_lexicon() -> tuple[dict, dict[str, str]]:
    """Читает native_lexicon.json и строит обратный индекс alias → gloss id."""
    with open(_LEXICON_PATH, encoding="utf-8") as f:
        data = json.load(f)
    index: dict[str, str] = {}
    for gloss_id, entry in data.get("glosses", {}).items():
        index[gloss_id] = gloss_id
        for alias in entry.get("aliases", []):
            index[alias.lower()] = gloss_id
    return data, index


# Загружаем один раз на импорт модуля (файл маленький, лежит рядом с кодом).
LEXICON, _GLOSS_INDEX = _load_lexicon()


def native_gloss(word: str) -> str | None:
    """gloss id для слова, если наш аватар знает лексический жест, иначе None."""
    return _GLOSS_INDEX.get(word.lower())


def _spell_sign(letters: list[str], alphabet: str) -> dict:
    return {"kind": "spell", "alphabet": alphabet, "letters": letters}


def _ru_track(text: str) -> list[dict]:
    """SIGN_LANG=ru_dactyl: дактилируем исходную кириллицу, без перевода."""
    signs: list[dict] = []
    spelled = 0
    words = [w for w in _RU_WORD_RE.findall(text.lower()) if len(w) >= 2]
    for w in words[:_MAX_WORDS]:
        if spelled >= _MAX_LETTERS:
            break
        take = list(w)[: _MAX_LETTERS - spelled]
        if signs:
            signs.append({"kind": "gap"})
        signs.append(_spell_sign(take, "ru"))
        spelled += len(take)
    return signs


def _hybrid_track(en_text: str) -> list[dict]:
    """Лексический жест, если есть в словаре, иначе ASL-дактиль (как в SiGML).

    Важно: словарь проверяется ДО стоп-фильтра — «hi», «ok» и т.п. входят в
    _SKIP (их бессмысленно дактилировать), но лексический жест для них есть
    и показывать его нужно.
    """
    signs: list[dict] = []
    spelled = 0
    used = 0
    words = [w for w in _EN_WORD_RE.findall(en_text.lower()) if len(w) >= 2]
    for w in words:
        if used >= _MAX_WORDS:
            break
        gloss = native_gloss(w)
        if gloss:
            if signs:
                signs.append({"kind": "gap"})
            signs.append({"kind": "gloss", "id": gloss})
            used += 1
        elif w not in _SKIP and spelled < _MAX_LETTERS:
            take = list(w)[: _MAX_LETTERS - spelled]
            if signs:
                signs.append({"kind": "gap"})
            signs.append(_spell_sign(take, "asl"))
            spelled += len(take)
            used += 1
    return signs


def build_pose_track(text: str, en_text: str) -> dict | None:
    """
    Построить pose-track для сегмента.

    Args:
        text:    исходный текст сегмента (RU/KZ/EN как сказано).
        en_text: текст после перевода на EN (для словарного матчинга).

    Returns:
        dict трека или None, если жестов не получилось (пусто/только стоп-слова).
    """
    if config.SIGN_LANG == "ru_dactyl":
        signs = _ru_track(text)
    else:
        signs = _hybrid_track(en_text)
        if not signs:
            # Никогда не молчим на содержательном сегменте — как и SiGML-ветка,
            # падаем в чистый дактиль без стоп-фильтра.
            words = _EN_WORD_RE.findall(en_text.lower())[:_MAX_WORDS]
            spelled = 0
            for w in words:
                if spelled >= _MAX_LETTERS:
                    break
                take = list(w)[: _MAX_LETTERS - spelled]
                if signs:
                    signs.append({"kind": "gap"})
                signs.append(_spell_sign(take, "asl"))
                spelled += len(take)

    if not signs:
        # Перевод недоступен/не сработал, EN-слов нет, но текст кириллический —
        # дактилируем русской азбукой. CWASA так не умеет; свой аватар умеет.
        signs = _ru_track(text)

    if not signs:
        return None
    return {"v": 1, "signs": signs}
