# Запуск SoundSight — пошаговый гайд

Доступность лекций для слабослышащих: живые субтитры + жестовый 3D-аватар +
авто-резюме сессии. Бэкенд — FastAPI (Python), фронтенд — React (Vite + TS).

Есть **два пути**: Docker (один командой) или локально (бэкенд + фронт раздельно).
Для демо проще всего: собрать фронт один раз и запустить только бэкенд — он сам
отдаёт собранный React.

---

## 0. Требования

- **Python ≥ 3.11** (в проекте проверено на 3.13)
- **Node ≥ 18** (проверено на 24) — нужен только если правишь/собираешь фронт
- **GPU + CUDA** — опционально; есть → ASR на видеокарте (быстро), нет → CPU-модель
- **Docker** — опционально (вариант A)
- **uv** — опционально, как менеджер зависимостей (см. ниже); можно и без него

---

## Вариант A. Docker (самый простой)

```bash
docker compose up --build      # первая сборка долгая (torch/whisper)
# открыть http://localhost:8000
```

```bash
docker compose up -d           # запустить в фоне
docker compose logs -f         # смотреть логи
docker compose down            # остановить
```

> LLM-ключ (опционально) кладётся в `.env` (см. шаг B3) — compose подхватит его через `env_file`.

---

## Вариант B. Локально

### B1. Установить зависимости бэкенда

**С uv (как задумано в проекте):**
```bash
uv sync                  # создаст .venv из uv.lock; первый раз долго (torch/whisper)
uv sync --extra dev      # + pytest (для тестов)
uv sync --extra ml       # + инструменты захвата поз (опционально)
```

**Без uv** (если пакеты уже стоят в твоём Python — fastapi/pydantic/uvicorn/torch/whisper):
```bash
pip install -r requirements.txt
```

### B2. Собрать фронтенд (один раз — тогда бэкенд сам его отдаёт)

```bash
cd frontend-react
npm ci
npm run build            # → frontend-react/dist (бэкенд отдаёт его с :8000)
cd ..
```

### B3. (Опционально) LLM для резюме сессии

Без ключа всё работает офлайн (резюме строит встроенный экстрактор). Чтобы
включить LLM (напр. Gemini через OpenAI-совместимый endpoint), создай `.env`:

```bash
# .env (gitignored — НЕ коммитить)
SOUNDSIGHT_ENABLE_LLM=true
SOUNDSIGHT_LLM_API_KEY=ВАШ_КЛЮЧ
SOUNDSIGHT_LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
SOUNDSIGHT_LLM_MODEL=gemini-2.5-flash
```

### B4. Запустить бэкенд

```bash
uv run python main.py        # или просто:  python main.py
```

Что увидишь в логах (≈10–40 c — грузится ASR-модель):
```
serving React SPA from .../frontend-react/dist
Loading large-v3-turbo (mode=ru) on cuda...      # или на cpu
Loaded on cuda fp16, VRAM=1.5GB
ASR warmup done ... | Uvicorn running on http://0.0.0.0:8000
```

Открой **http://localhost:8000** (именно `localhost` — для камеры нужен
secure-context; по IP `0.0.0.0`/`192.168…` браузер камеру не даст).

Проверка, что жив:
```bash
curl http://localhost:8000/health      # {"status":"ok"}
```

### B5. (Опционально) Dev-режим фронта с горячей перезагрузкой

Нужен только если правишь UI. В отдельном терминале, **бэкенд из B4 должен быть запущен**:
```bash
cd frontend-react
npm run dev                  # http://localhost:5173 (проксирует API на :8000)
```

---

## Тесты

```bash
uv run pytest                       # бэкенд (юнит + интеграция); или: python -m pytest
node ml/retarget_pose_test.mjs      # ретаргет позы (TS-математика)
node ml/retarget_test.mjs           # кватернионы скиновой модели
node ml/spread_test.mjs             # разведение пальцев
node ml/one_euro_test.mjs           # сглаживание живого зеркала
node ml/hand_orient_test.mjs        # ориентация кисти
```

---

## Симуляция аватара (headless, без камеры)

Рендер аватара в позе кисти через Chromium → PNG (для отладки ориентации):
```bash
cd ml/sim && npm install            # один раз (playwright)
npx playwright install chromium     # один раз (скачать браузер)
cd ../..
node ml/sim/shot.mjs r_palm_up r_back_up l_palm_up   # → ml/sim/shots/*.png
```

---

## Остановить

- **Локально:** `Ctrl+C` в терминале бэкенда.
- Если запускал в фоне и порт занят — найти и убить процесс на :8000:
  ```powershell
  Get-NetTCPConnection -LocalPort 8000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
  ```
- **Docker:** `docker compose down`.

---

## Траблшутинг

- **В редакторе красным горят `fastapi`/`pydantic`** — пакеты установлены, но
  VS Code выбрал не тот интерпретатор. `Ctrl+Shift+P` → **Python: Select
  Interpreter** → выбрать `.venv\Scripts\python.exe` (после `uv sync`) или тот
  Python, где стоят пакеты.
- **Камера не включается / гаснет** — открывай через `http://localhost:8000`
  (не по IP). Камера работает только в secure-context (localhost или https).
- **Первый запуск долгий** — грузится Whisper-модель (на CPU тянет `base`, на
  GPU — `large-v3-turbo`). Кэшируется, дальше быстрее.
- **Порт 8000 занят** — поменяй `PORT` в `.env` или убей процесс (см. «Остановить»).
- **Нет GPU** — это норм: бэкенд сам переключится на CPU-модель (`ASR_MODEL_CPU=base`).
