import type { Screen } from "../App";
import { useSession } from "../state/SessionContext";
import { ThemeToggle } from "./ThemeSwitcher";

// Иконки разделов (inline SVG — без зависимостей).
const icons: Record<Screen, () => JSX.Element> = {
  home: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  ),
  subtitles: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M7 11h3M7 15h6M14 11h3" />
    </svg>
  ),
  summary: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
      <path d="M8 10h8M8 14h8M8 18h5" />
    </svg>
  ),
  history: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 4v4h4" />
      <path d="M12 8v4l3 2" />
    </svg>
  ),
  lab: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3v6.5L3.6 17a2.4 2.4 0 0 0 2.1 3.6h12.6a2.4 2.4 0 0 0 2.1-3.6L16 9.5V3" />
      <path d="M6.5 3h11" />
      <path d="M7 14h10" />
    </svg>
  ),
  settings: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  ),
};

const ITEMS: { key: Screen; label: string }[] = [
  { key: "home", label: "Обзор" },
  { key: "subtitles", label: "Субтитры" },
  { key: "summary", label: "Резюме" },
  { key: "history", label: "История" },
  { key: "lab", label: "Аватар-лаб" },
  { key: "settings", label: "Настройки" },
];

// Боковая панель: бренд, навигация и постоянное управление записью.
export function Sidebar({
  screen,
  onNavigate,
}: {
  screen: Screen;
  onNavigate: (s: Screen) => void;
}) {
  const { active, statusText } = useSession();

  return (
    <aside className="sidebar">
      <a href="#main-content" className="skip-link">
        Перейти к содержимому
      </a>

      <div className="sidebar-brand">
        <span className="brand-mark" aria-hidden="true">
          SS
        </span>
        <span className="brand-text">
          <span className="brand-name">SoundSight</span>
          <span className="brand-tagline">Агент доступности</span>
        </span>
      </div>

      <nav className="sidebar-nav" aria-label="Основная навигация">
        {ITEMS.map(({ key, label }) => {
          const Icon = icons[key];
          return (
            <button
              key={key}
              type="button"
              className={`side-link${screen === key ? " active" : ""}`}
              aria-current={screen === key ? "page" : undefined}
              onClick={() => onNavigate(key)}
            >
              <span className="side-link-icon">
                <Icon />
              </span>
              <span className="side-link-label">{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <div className="sidebar-statusrow">
          <div className="rec-status" aria-live="polite">
            <span
              className={`status-dot${active ? " recording" : " ready-static"}`}
              aria-hidden="true"
            />
            <span className="rec-status-text">
              {statusText || (active ? "Идёт запись" : "Готов к записи")}
            </span>
          </div>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
