import { useSession } from "../state/SessionContext";

// Управление сессией (ТЗ §4.2): Начать запись / Остановить + индикатор статуса.
export function SessionControls() {
  const { active, phase, start, stop } = useSession();
  const connecting = phase === "connecting";
  const stopping = phase === "stopping";

  return (
    <div className="session-controls">
      {!active ? (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void start()}
          disabled={stopping}
        >
          <span className="btn-rec-dot" aria-hidden="true" />
          Начать запись
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-stop"
          onClick={() => void stop()}
          disabled={connecting}
        >
          <span className="btn-stop-icon" aria-hidden="true" />
          Остановить
        </button>
      )}
    </div>
  );
}
