# SoundSight — запуск через Docker

Весь проект (бэкенд FastAPI + собранный React-фронт) поднимается **одной командой**.

## Требования
- **Docker Desktop** (Windows). Установщик качается на диск `D:` (см. ниже),
  либо скачать вручную: https://www.docker.com/products/docker-desktop/
- После установки Docker Desktop должен быть **запущен** (иконка кита в трее).

## Запуск

Из папки проекта (`C:\Users\Denry\Desktop\SoundSight`):

```powershell
docker compose up --build
```

- Первый запуск **долгий** (5–15 мин): собирается образ (torch/whisper/transformers)
  и при первом старте качаются веса модели + офлайн-переводчик RU→EN.
- Когда в логах появится `Application startup complete` — открывай:

  **http://localhost:8000**

Запуск в фоне:

```powershell
docker compose up --build -d      # поднять в фоне
docker compose logs -f            # смотреть логи
docker compose down               # остановить
```

## Заметки
- Веса модели и пакет перевода кэшируются в томах `SoundSight-models` / `SoundSight-argos` —
  при повторных запусках уже не качаются.
- В контейнере ASR работает на **CPU** (модель `base`). GPU-проброс в Docker
  Desktop требует отдельной настройки (WSL2 + NVIDIA) — по умолчанию выключен.
- ИИ-резюме (опционально): раскомментируй `SOUNDSIGHT_ENABLE_LLM` и ключ в
  `docker-compose.yml` (или подключи `.env`).
