# SoundSight Frontend (новый дизайн)

Новый фронтенд для **SoundSight — Lecture Accessibility Agent** (React + Vite + TypeScript).
Совместим с существующим бэкендом по контракту из ТЗ (`LAA_Frontend_TZ.md`, §6).

## Запуск (разработка)

```bash
npm install
npm run dev
```

Dev-сервер поднимется на http://localhost:5173 и **проксирует** весь контракт
интеграции на бэкенд SoundSight (FastAPI, по умолчанию `http://127.0.0.1:8000`):
`/session/*`, `/summary/*`, `/avatar/*`, `/health`, `/ws/subtitles`, `/cwaclientcfg.json`.

Другой адрес бэкенда:

```bash
# PowerShell
$env:SOUNDSIGHT_BACKEND="http://127.0.0.1:9000"; npm run dev
```

> Бэкенд должен быть запущен (`py main.py` в репозитории SoundSight) — иначе старт
> сессии, аватар и резюме работать не будут. Нужен интернет: движок аватара
> CWASA грузится с `vhg.cmp.uea.ac.uk/.../vhg2026/cwa/` (ТЗ §6.6).

## Сборка (продакшн)

```bash
npm run build      # → dist/ (статика)
npm run preview    # локальный предпросмотр сборки
```

`dist/` — статичные файлы; ассеты кладутся в `dist/assets/` (совпадает с тем,
как бэкенд монтирует `/assets`). Для деплоя содержимое `dist/` отдаётся как
статика тем же сервером.

## Структура

```
src/
  integration/   ФИКСИРОВАННЫЙ слой контракта (ТЗ §6.2–6.6) — менять только за бэкендом
    types.ts       типы REST + WS-сообщений
    api.ts         REST-клиент
    audioFrame.ts  сборка бинарного аудио-кадра (магия "LAA\0")
    cwasa.ts       обёртка движка аватара + очередь жестов
    session.ts     жизненный цикл: REST + WebSocket + захват аудио
  state/         SessionContext — глобальное состояние сессии для UI
  components/    переиспользуемые компоненты UI
  screens/       экраны: Home, Subtitles, Summary, History, Settings
  styles/        тема (красная, тёмная) + глобальная вёрстка
public/
  recorder-worklet.js  AudioWorklet, кадры ~0.5 с (ТЗ §6.5)
  cwaclientcfg.json    конфиг аватара (dev; в проде отдаёт бэкенд)
```

## Что реализовано в этом заходе

- Полный каркас: навигация, тема, слой интеграции.
- **Ключевой экран субтитров**: аватар CWASA + поток субтитров
  (interim/final с визуальным отличием), keywords, очередь жестов,
  управление сессией, переключение языка, регулировка размера шрифта.
- Экраны Home / Settings (микрофон, язык) / Summary (живой транскрипт + резюме) /
  History (моковые данные) — функциональны; визуал можно дорабатывать.
- Доступность: skip-link, фокус, ARIA, `prefers-reduced-motion`.

## Чек-лист приёмки ТЗ (§11)

Слой интеграции реализует §6.2–6.6 точь-в-точь; проверять с запущенным бэкендом.
```
