import { useEffect, useState } from "react";

import { api } from "../integration/api";
import type { SessionMeta } from "../integration/types";

// История сессий (ТЗ §4.4): реальные завершённые сессии с бэкенда (GET /sessions).
// Сессии хранятся в памяти сервера (последние 50) — переживают переходы между
// экранами, но не перезапуск контейнера.

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function History() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getSessions()
      .then((data) => {
        if (!cancelled) setSessions(data.sessions);
      })
      .catch(() => {
        if (!cancelled) setError("Не удалось загрузить историю сессий.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const opened = sessions.find((s) => s.session_id === openId) ?? null;

  return (
    <div className="screen history-screen">
      <h1 className="screen-title">История сессий</h1>
      <p className="screen-subtitle">
        Завершённые сессии этого сервера. Нажмите карточку, чтобы открыть резюме.
      </p>

      {loading && <p className="summary-empty">Загрузка истории…</p>}
      {error && !loading && <p className="summary-empty">{error}</p>}

      {!loading && !error && sessions.length === 0 && (
        <p className="summary-empty">
          Пока нет завершённых сессий. Запустите запись на экране «Субтитры» и
          остановите её — сессия появится здесь.
        </p>
      )}

      {sessions.length > 0 && (
        <div className="history-grid">
          {sessions.map((s) => (
            <button
              key={s.session_id}
              type="button"
              className="history-card"
              onClick={() => setOpenId(s.session_id)}
            >
              <span className="history-card-date">{formatDate(s.started_at)}</span>
              <span className="history-card-title">{s.title}</span>
              <span className="history-card-preview">
                {s.summary.split("\n")[0]}
              </span>
            </button>
          ))}
        </div>
      )}

      {opened && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={opened.title}
          onClick={() => setOpenId(null)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2 className="modal-title">{opened.title}</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setOpenId(null)}
                aria-label="Закрыть"
              >
                ✕
              </button>
            </div>
            <p className="modal-body">{opened.summary}</p>
          </div>
        </div>
      )}
    </div>
  );
}
