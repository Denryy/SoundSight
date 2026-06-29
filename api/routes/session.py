import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.session import session_manager
from core.pipeline import pipeline

logger = logging.getLogger("soundsight.session")

router = APIRouter(prefix="/session", tags=["session"])


class SessionResponse(BaseModel):
    session_id: str
    status: str


@router.post("/start", response_model=SessionResponse)
async def start_session() -> SessionResponse:
    existing = session_manager.current()
    if existing and existing.active:
        return SessionResponse(session_id=existing.id, status="already_running")

    session = session_manager.create()
    pipeline.reset_state()
    return SessionResponse(session_id=session.id, status="started")


@router.post("/stop", response_model=SessionResponse)
async def stop_session() -> SessionResponse:
    session = session_manager.stop_current()
    if session is None:
        return SessionResponse(session_id="", status="no_active_session")
    # Резюме и заголовок считаем сразу при стопе — чтобы экраны «Резюме» и
    # «История» получили их без отдельного запроса/ленивого расчёта. При
    # SOUNDSIGHT_ENABLE_LLM=true их строит LLM (Gemini), иначе — офлайн-экстрактор.
    if session.summary is None:
        from processing.summarizer import build_session_meta
        session.title, session.summary = await build_session_meta(
            session.full_transcript(), session.started_at
        )
    return SessionResponse(session_id=session.id, status="stopped")


_VALID_MODES = {"auto", "ru", "en", "kz"}


@router.post("/mode/{mode}")
async def set_mode(mode: str) -> dict:
    if mode not in _VALID_MODES:
        raise HTTPException(status_code=400, detail=f"Invalid mode. Use: {_VALID_MODES}")
    import asyncio
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(None, pipeline.set_asr_mode, mode)
    except Exception:
        # The engine reverts to the previous working mode on reload failure
        # (see WhisperEngine.set_mode); report it and echo the actual mode.
        logger.exception("ASR mode switch to %s failed", mode)
        raise HTTPException(
            status_code=503,
            detail=f"ASR model switch failed; kept previous mode '{pipeline.asr_mode}'",
        )
    pipeline.reset_state()  # clear agent state on lang switch
    return {"mode": pipeline.asr_mode}


@router.get("/mode")
async def get_mode() -> dict:
    return {"mode": pipeline.asr_mode}


@router.get("/status")
async def session_status() -> dict:
    session = session_manager.current()
    if session is None:
        return {"active": False}
    return {
        "active": session.active,
        "session_id": session.id,
        "transcript_chunks": len(session.transcript),
    }


@router.get("/agent/stats")
async def agent_stats() -> dict:
    """Return AgentController runtime statistics (accept/reject counts, word budget)."""
    from agent.controller import agent_controller as _ac
    return _ac.stats


@router.get("/agent/recent-decisions")
async def agent_recent_decisions() -> dict:
    """
    Return the last N agent decisions with full routing flags and explainability data.

    Each entry contains:
      text snippet, verdict, importance score, routing flags, reason, elapsed_ms.
    Useful for demo observability and debugging.
    """
    from agent.controller import agent_controller as _ac
    from agent.llm_refiner import status as llm_status
    return {
        "decisions": list(_ac.stats["recent_reasons"]),
        "total_in_session": _ac.stats["total"],
        "llm": llm_status(),
    }
