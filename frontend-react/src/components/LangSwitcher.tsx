import { useSession } from "../state/SessionContext";
import type { LangMode } from "../integration/types";

const LANGS: { mode: LangMode; label: string }[] = [
  { mode: "auto", label: "Авто" },
  { mode: "ru", label: "RU" },
  { mode: "en", label: "EN" },
  { mode: "kz", label: "KZ" },
];

// Переключатель языка распознавания (ТЗ §4.5, §5). KZ грузит модель ~10 сек.
export function LangSwitcher() {
  const { lang, langSwitching, setLang } = useSession();

  return (
    <div className="lang-switcher" role="group" aria-label="Язык распознавания">
      {LANGS.map((l) => (
        <button
          key={l.mode}
          type="button"
          className={`lang-btn${lang === l.mode ? " active" : ""}`}
          aria-pressed={lang === l.mode}
          disabled={langSwitching}
          onClick={() => void setLang(l.mode)}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
