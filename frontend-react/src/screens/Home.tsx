import { useEffect, useState } from "react";

import type { Screen } from "../App";
import { api } from "../integration/api";
import type { SessionMeta } from "../integration/types";
import { useSession } from "../state/SessionContext";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Главная (ТЗ §4.1) — рабочий дашборд: запуск сессии + недавние сессии.
export function Home({ onNavigate }: { onNavigate: (s: Screen) => void }) {
  const { start, active } = useSession();
  const [recent, setRecent] = useState<SessionMeta[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getSessions()
      .then((d) => {
        if (!cancelled) setRecent(d.sessions.slice(0, 4));
      })
      .catch(() => {
        if (!cancelled) setRecent([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const startSession = () => {
    onNavigate("subtitles");
    setTimeout(() => void start(), 100);
  };

  return (
    <div className="screen home-screen">
      <div className="home-head">
        <h1 className="home-greeting">Обзор</h1>
        <p className="home-sub">
          Запустите запись — субтитры и жестовый аватар появятся на экране
          «Субтитры», а после остановки соберётся резюме.
        </p>
      </div>

      <div className="overview-grid">
        {/* Главное действие */}
        <section className="start-card" aria-label="Запуск сессии">
          <span className="start-eyebrow">{active ? "Сессия идёт" : "Новая сессия"}</span>
          <h2 className="start-title">
            {active ? "Запись в эфире" : "Готовы начать запись?"}
          </h2>
          <p className="start-text">
            SoundSight слушает микрофон и в реальном времени превращает речь в субтитры
            и жесты — доступность лекций для слабослышащих.
          </p>

          <ol className="start-steps">
            <li className="start-step">
              <b>1</b> Разрешите доступ к микрофону
            </li>
            <li className="start-step">
              <b>2</b> Следите за субтитрами и аватаром в эфире
            </li>
            <li className="start-step">
              <b>3</b> Остановите — получите резюме и ключевые темы
            </li>
          </ol>

          <div className="start-actions">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={active ? () => onNavigate("subtitles") : startSession}
            >
              <span className="btn-rec-dot" aria-hidden="true" />
              {active ? "Открыть эфир" : "Начать запись"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-lg"
              onClick={() => onNavigate("settings")}
            >
              Настройки
            </button>
          </div>

          <div className="start-langs" aria-label="Поддерживаемые языки">
            <span>Распознавание:</span>
            <span className="lang-chip">Авто</span>
            <span className="lang-chip">Русский</span>
            <span className="lang-chip">English</span>
            <span className="lang-chip">Қазақша</span>
          </div>
        </section>

        {/* Недавние сессии */}
        <section className="recent-card" aria-label="Недавние сессии">
          <div className="recent-head">
            <span className="section-label">Недавние сессии</span>
            {recent && recent.length > 0 && (
              <button
                type="button"
                className="recent-link"
                onClick={() => onNavigate("history")}
              >
                Все →
              </button>
            )}
          </div>

          {recent === null ? (
            <p className="recent-empty">Загрузка…</p>
          ) : recent.length === 0 ? (
            <p className="recent-empty">
              Пока нет завершённых сессий. Запустите запись — она появится здесь.
            </p>
          ) : (
            <div className="recent-list">
              {recent.map((s) => (
                <button
                  key={s.session_id}
                  type="button"
                  className="recent-item"
                  onClick={() => onNavigate("history")}
                >
                  <span className="recent-item-title">{s.title}</span>
                  <span className="recent-item-meta">
                    {formatDate(s.started_at)} · {s.chunks} фрагм.
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
