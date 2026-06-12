import { useEffect, useState } from "react";

import { api } from "../integration/api";
import { useSession } from "../state/SessionContext";

// Резюме (ТЗ §4.3):
//  - после остановки сессии — структурированное резюме;
//  - во время сессии — «живая запись» (полный транскрипт, опрос ~каждые 3 сек).
export function Summary() {
  const { summary, active } = useSession();
  const [live, setLive] = useState("");

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await api.getLiveSummary();
        if (!cancelled && data.text) setLive(data.text);
      } catch {
        /* во время сессии транскрипт может быть ещё пуст */
      }
    };
    void poll();
    const id = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active]);

  return (
    <div className="screen summary-screen">
      <h1 className="screen-title">{active ? "Живая запись" : "Резюме сессии"}</h1>

      {active ? (
        <section className="summary-card">
          <p className="summary-badge live">● Идёт запись — транскрипт обновляется</p>
          {live ? (
            <p className="summary-text">{live}</p>
          ) : (
            <p className="summary-empty">Транскрипт появится по мере распознавания речи…</p>
          )}
        </section>
      ) : summary ? (
        <section className="summary-card">
          <p className="summary-text">{summary}</p>
        </section>
      ) : (
        <p className="summary-empty">
          Резюме появится после завершения сессии. Запустите запись на экране
          «Субтитры» и остановите её, чтобы получить итог.
        </p>
      )}
    </div>
  );
}
