# SoundSight Frontend — дизайн-спецификация (v1)

**Дата:** 2026-06-05
**Источник требований:** `C:\Users\izbas\Downloads\LAA_Frontend_TZ.md` (ТЗ v1.0)

## Решения

| Вопрос | Решение |
|---|---|
| Фреймворк | React 18 + Vite + TypeScript |
| Объём v1 | Каркас проекта + полностью рабочий экран субтитров; остальные экраны функциональны |
| Аудио-кадр | ~0.5 с на фрейм (ТЗ §6.3), а не 3 с как в старой реализации |
| Тема | Тёмная, основной акцент — красный (по пожеланию заказчика; дорабатываемо) |
| Местоположение | `C:\Users\izbas\OneDrive\Desktop\soundsight-frontend\` |

## Архитектурный принцип

Визуальный слой свободен, **слой интеграции фиксирован** (ТЗ §2). Весь контракт
(REST §6.2, WS-аудио §6.3, сообщения сервера §6.4, AudioWorklet §6.5, CWASA §6.6)
изолирован в `src/integration/`. UI вызывает его через `SessionContext` и не знает
деталей протокола.

## Слой интеграции (`src/integration/`)

- **types.ts** — типы REST-ответов и WS-сообщений (`subtitle_interim`, `subtitle`).
- **api.ts** — типизированный REST-клиент (относительный origin).
- **audioFrame.ts** — `buildAudioFrame()` (магия `0x4C414100` BE + sampleRate LE +
  float32 PCM LE), `subtitlesWsUrl()` (ws/wss).
- **cwasa.ts** — обёртка глобального движка CWASA: init, хуки
  `avatarloaded/avatarready/animidle`, последовательная очередь жестов (лимит 5,
  пустой sigml игнорируется).
- **session.ts** — `SessionController`: микрофон → `POST /session/start` → WS
  `/ws/subtitles` → AudioWorklet (0.5 с) → бинарные кадры. Разбор входящих
  сообщений, обработка ошибок (нет микрофона / сервер недоступен / обрыв WS),
  стоп → `POST /session/stop` → отдаёт `session_id` для резюме.

## UI

- **state/SessionContext.tsx** — глобальное состояние; interim отдельным стейтом
  (производительность, ТЗ §9), finals списком, keywords, язык, микрофоны,
  размер шрифта (persist в localStorage), резюме.
- **screens/** — Home, Subtitles (ключевой), Summary (живой транскрипт + итог),
  History (мок), Settings (микрофон, язык, статус).
- **components/** — Nav, StatusDot, ErrorBanner, AvatarPanel, SubtitleStream,
  KeywordTags, SessionControls, LangSwitcher, FontSizeControl.

## Доступность (ТЗ §8)

Skip-link, видимый фокус (`:focus-visible`), ARIA-роли/лейблы, `aria-live` для
субтитров и статуса, регулируемый размер субтитров, чёткое визуальное отличие
interim (курсив, приглушённый, красная полоса) от final, поддержка
`prefers-reduced-motion`, всё статусное — визуально (без звука).

## Не входит в v1 (задел)

- Реальная история сессий (ждёт бэкенд).
- Светлая тема (переменные заведены, переключателя UI пока нет).
- Хелперы отладки `spell()`/расширенный `previewSign` UI.
