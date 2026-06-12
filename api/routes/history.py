from fastapi import APIRouter
from pydantic import BaseModel

from core.session import session_manager
from processing.summarizer import build_session_meta

router = APIRouter(tags=["history"])


class SessionMeta(BaseModel):
    session_id: str
    title: str
    started_at: str
    ended_at: str | None
    summary: str
    chunks: int


class SessionListResponse(BaseModel):
    sessions: list[SessionMeta]


@router.get("/sessions", response_model=SessionListResponse)
async def list_sessions() -> SessionListResponse:
    """Завершённые сессии для экрана История (новейшие первыми)."""
    items: list[SessionMeta] = []
    for s in session_manager.list_finished():
        # Compute title+summary once and cache on the session. Normally already
        # populated at /session/stop; this lazily fills any session that wasn't
        # (e.g. summary computed before this code path existed).
        if s.summary is None or s.title is None:
            s.title, s.summary = await build_session_meta(
                s.full_transcript(), s.started_at
            )
        items.append(
            SessionMeta(
                session_id=s.id,
                title=s.title,
                started_at=s.started_at.isoformat(),
                ended_at=s.ended_at.isoformat() if s.ended_at else None,
                summary=s.summary,
                chunks=len(s.transcript),
            )
        )
    return SessionListResponse(sessions=items)
