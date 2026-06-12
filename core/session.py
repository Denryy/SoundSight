import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

# A single lecture rarely needs more than a few hundred accepted segments;
# cap the transcript so a stuck/abusive session can't grow memory without bound.
MAX_TRANSCRIPT_SEGMENTS = 5_000

# Retain only the most recent finished sessions so summaries stay fetchable
# for a while without leaking memory across long-lived server processes.
MAX_RETAINED_SESSIONS = 50


@dataclass
class Session:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    ended_at: Optional[datetime] = None
    transcript: list[str] = field(default_factory=list)
    summary: Optional[str] = None
    title: Optional[str] = None
    active: bool = True

    def append_text(self, text: str) -> None:
        # Drop the oldest segment past the cap (FIFO) to bound memory while
        # keeping the most recent context for live summary/transcript views.
        if len(self.transcript) >= MAX_TRANSCRIPT_SEGMENTS:
            self.transcript.pop(0)
        self.transcript.append(text)

    def stop(self) -> None:
        self.active = False
        self.ended_at = datetime.now(timezone.utc)

    def full_transcript(self) -> str:
        return " ".join(self.transcript)


class SessionManager:
    def __init__(self) -> None:
        self._sessions: "OrderedDict[str, Session]" = OrderedDict()
        self._current: Optional[str] = None

    def create(self) -> Session:
        # Force-stop any lingering active session before creating a new one
        existing = self.current()
        if existing and existing.active:
            existing.stop()
        session = Session()
        self._sessions[session.id] = session
        self._current = session.id
        self._evict_old()
        return session

    def _evict_old(self) -> None:
        """Bound retained sessions, never evicting the current one."""
        while len(self._sessions) > MAX_RETAINED_SESSIONS:
            oldest_id, _ = next(iter(self._sessions.items()))
            if oldest_id == self._current:
                # Move current to the end so it survives eviction.
                self._sessions.move_to_end(oldest_id)
                continue
            self._sessions.popitem(last=False)

    def current(self) -> Optional[Session]:
        if self._current:
            return self._sessions.get(self._current)
        return None

    def get(self, session_id: str) -> Optional[Session]:
        return self._sessions.get(session_id)

    def list_finished(self) -> list[Session]:
        """Завершённые сессии, новейшие первыми (для экрана История)."""
        return [s for s in reversed(self._sessions.values()) if not s.active]

    def stop_current(self) -> Optional[Session]:
        session = self.current()
        if session:
            session.stop()
            self._current = None
        return session


session_manager = SessionManager()
