import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from api.routes import session as session_routes
from api.routes import summary as summary_routes
from api.routes import avatar as avatar_routes
from api.routes import history as history_routes
from api.routes import dataset as dataset_routes
from api.ws.subtitles import ws_endpoint
from core.logging_config import setup_logging
from core.pipeline import pipeline

setup_logging()
logger = logging.getLogger("soundsight.server")


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    logger.info("Pre-loading ASR model...")
    await asyncio.get_running_loop().run_in_executor(None, pipeline.ensure_loaded)
    logger.info("ASR model ready.")
    # Preload RU->EN translator in background (downloads ~50MB on first run)
    try:
        from avatar.translator import preload_async
        preload_async()
    except Exception:
        logger.debug("translator preload skipped", exc_info=True)
    yield


app = FastAPI(title="SoundSight", lifespan=lifespan)

# NOTE: CORSMiddleware is intentionally omitted — it breaks WebSocket in Starlette 1.0.
# Frontend is served from the same origin so CORS is not needed.

app.include_router(session_routes.router)
app.include_router(summary_routes.router)
app.include_router(avatar_routes.router)
app.include_router(history_routes.router)
app.include_router(dataset_routes.router)


@app.websocket("/ws/subtitles")
async def websocket_subtitles(websocket: WebSocket) -> None:
    await ws_endpoint(websocket, pipeline.process_bytes)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


# ── Frontend ────────────────────────────────────────────────────────────────
# Prefer the built React SPA (frontend-react/dist); fall back to the legacy
# vanilla UI (frontend/) when the build is absent. Declared AFTER the API
# routes and WebSocket so those always win over the static catch-all mount.
ROOT = Path(__file__).parent.parent
REACT_DIST = ROOT / "frontend-react" / "dist"
LEGACY_DIR = ROOT / "frontend"

if (REACT_DIST / "index.html").exists():
    logger.info("serving React SPA from %s", REACT_DIST)
    # The Vite build keeps index.html, /assets/*, /recorder-worklet.js and
    # /cwaclientcfg.json all at the dist root — one html=True mount covers all.
    app.mount("/", StaticFiles(directory=str(REACT_DIST), html=True), name="web")
else:
    logger.info("React build absent — serving legacy vanilla UI from %s", LEGACY_DIR)
    app.mount("/static", StaticFiles(directory=str(LEGACY_DIR)), name="static")

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(str(LEGACY_DIR / "index.html"))

    @app.get("/cwaclientcfg.json")
    async def cwasa_config() -> FileResponse:
        """CWASA looks for this file at the page root."""
        return FileResponse(str(LEGACY_DIR / "cwaclientcfg.json"), media_type="application/json")
