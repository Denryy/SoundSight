import { useSession } from "../state/SessionContext";

// Баннер ошибок (ТЗ §7): нет микрофона / сервер недоступен / обрыв WS.
export function ErrorBanner() {
  const { error, dismissError } = useSession();
  if (!error) return null;
  return (
    <div className="error-banner" role="alert">
      <span className="error-banner-text">{error}</span>
      <button
        type="button"
        className="error-banner-close"
        onClick={dismissError}
        aria-label="Закрыть сообщение"
      >
        ✕
      </button>
    </div>
  );
}
