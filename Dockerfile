# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# SoundSight — production image. Multi-stage: собираем React-фронт, затем кладём его
# в Python-образ с бэкендом. Один контейнер отдаёт и API, и собранный фронт.
#
# Python-зависимости ставятся через uv (Astral): параллельные загрузки +
# надёжные таймауты/ретраи — устойчивее на медленной сети, чем pip, и быстрее.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: сборка фронтенда (Vite + TS) ───────────────────────────────────
FROM node:20-slim AS web
WORKDIR /web
COPY frontend-react/package.json frontend-react/package-lock.json ./
RUN npm ci
COPY frontend-react/ ./
RUN npm run build           # → /web/dist


# ── Stage 2: бэкенд (FastAPI + Whisper, CPU) ─────────────────────────────────
FROM python:3.11-slim AS app

# ВНИМАНИЕ: ENV / WORKDIR / apt ниже оставлены байт-в-байт как в pip-версии,
# чтобы тяжёлый apt-слой (~215 МБ, ~14 мин на медленной сети) взялся из кэша.
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# ffmpeg — для аудио-бэкендов whisper; build-essential — на случай сборки колёс.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg build-essential \
    && rm -rf /var/lib/apt/lists/*

# uv — статический бинарь из официального образа (без отдельной установки).
# Ставится ПОСЛЕ apt, чтобы не инвалидировать apt-слой выше.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
ENV UV_SYSTEM_PYTHON=1 \
    UV_HTTP_TIMEOUT=300

# CUDA-сборка torch (cu121) с официального индекса — для инференса на GPU.
# Совместима с драйвером 596.21 (CUDA 13.2, обратно совместима с 12.1).
# Колёса CUDA крупные (~2.5 ГБ), но GPU даёт large-v3-turbo fp16 вместо base.
# Контейнеру нужен проброс GPU (см. docker-compose.yml: deploy.resources).
# requirements.txt увидит torch уже стоящим. Кэш-маунт uv переживает ребилды.
COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --index-url https://download.pytorch.org/whl/cu121 \
        torch==2.3.1 torchaudio==2.3.1 \
    && uv pip install -r requirements.txt

# Код бэкенда + исходники фронта (на случай ребилда), затем — готовый dist.
COPY . .
COPY --from=web /web/dist ./frontend-react/dist

# На CPU используем облегчённую модель, чтобы стартовать без GPU.
ENV HOST=0.0.0.0 \
    PORT=8000 \
    ASR_MODE=ru \
    ASR_MODEL_CPU=base \
    SIGN_LANG=hybrid \
    SOUNDSIGHT_LOG_LEVEL=INFO

EXPOSE 8000

# Модель Whisper и пакет перевода скачиваются при первом старте в /root/.cache
# и /root/.local — их монтируем томами (см. docker-compose.yml), чтобы не качать
# повторно при каждом запуске.
CMD ["python", "main.py"]
