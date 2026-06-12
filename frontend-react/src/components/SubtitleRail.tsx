import { useEffect, useState } from "react";

import { useSession } from "../state/SessionContext";
import { KeywordTags } from "./KeywordTags";

function formatElapsed(sec: number): string {
  const s = String(sec % 60).padStart(2, "0");
  const m = Math.floor(sec / 60);
  if (m < 60) return `${String(m).padStart(2, "0")}:${s}`;
  const h = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2, "0")}:${s}`;
}

// Таймер сессии: считает с момента старта записи, обнуляется при остановке.
function useSessionTimer(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    setElapsed(0);
    const id = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [active]);
  return elapsed;
}

// Правая панель экрана субтитров: таймер, статус, счётчики, ключевые темы, подсказки.
export function SubtitleRail() {
  const { active, finals, keywords } = useSession();
  const elapsed = useSessionTimer(active);

  const words = finals.reduce(
    (n, l) => n + l.text.trim().split(/\s+/).filter(Boolean).length,
    0,
  );

  return (
    <aside className="subtitle-rail" aria-label="Сведения о сессии">
      <div className="rail-card">
        <span className="section-label">Сессия</span>

        <div className={`rail-timer${active ? " live" : ""}`}>
          {formatElapsed(elapsed)}
        </div>

        <div className="rail-status">
          <span
            className={`status-dot${active ? " recording" : " ready-static"}`}
            aria-hidden="true"
          />
          <span>{active ? "Идёт запись" : "Не активна"}</span>
        </div>

        <div className="rail-metrics">
          <div className="rail-metric">
            <b>{finals.length}</b>
            <span>реплик</span>
          </div>
          <div className="rail-metric">
            <b>{words}</b>
            <span>слов</span>
          </div>
        </div>
      </div>

      <div className="rail-card">
        <span className="section-label">Ключевые темы</span>
        {keywords.length ? (
          <KeywordTags />
        ) : (
          <p className="rail-empty">Появятся по ходу речи.</p>
        )}
      </div>

      <div className="rail-card rail-tips">
        <span className="section-label">Подсказки</span>
        <ul>
          <li>Размер субтитров — кнопками A−/A+ сверху.</li>
          <li>Язык распознавания переключается там же.</li>
          <li>Аватар можно сменить над окном жестов.</li>
        </ul>
      </div>
    </aside>
  );
}
