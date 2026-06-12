import type { Screen } from "../App";
import { StatusDot } from "./StatusDot";
import { useSession } from "../state/SessionContext";

const ITEMS: { key: Screen; label: string }[] = [
  { key: "home", label: "Главная" },
  { key: "subtitles", label: "Субтитры" },
  { key: "summary", label: "Резюме" },
  { key: "history", label: "История" },
  { key: "settings", label: "Настройки" },
];

export function Nav({
  screen,
  onNavigate,
}: {
  screen: Screen;
  onNavigate: (s: Screen) => void;
}) {
  const { active, statusText } = useSession();

  return (
    <header className="nav" role="banner">
      <a href="#main-content" className="skip-link">
        Перейти к содержимому
      </a>

      <div className="nav-brand">
        <span className="nav-logo" aria-hidden="true">
          SoundSight
        </span>
        <span className="nav-title">Агент доступности лекций</span>
      </div>

      <nav className="nav-links" aria-label="Основная навигация">
        {ITEMS.map((it) => (
          <button
            key={it.key}
            type="button"
            className={`nav-link${screen === it.key ? " active" : ""}`}
            aria-current={screen === it.key ? "page" : undefined}
            onClick={() => onNavigate(it.key)}
          >
            {it.label}
          </button>
        ))}
      </nav>

      <div className="nav-status" aria-live="polite">
        <StatusDot active={active} />
        <span className="nav-status-text">{statusText || (active ? "Запись" : "Готово")}</span>
      </div>
    </header>
  );
}
