import { useEffect, useState } from "react";

import { theme, type ThemePref } from "../integration/theme";

// Хук подписки на текущий выбор темы.
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(theme.get());
  useEffect(() => theme.subscribe(setPref), []);
  return { pref, setPref: (p: ThemePref) => theme.set(p) };
}

function IconSun() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
function IconMoon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}
function IconDevice() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

const OPTIONS: { value: ThemePref; label: string; icon: () => JSX.Element }[] = [
  { value: "light", label: "Светлая", icon: IconSun },
  { value: "dark", label: "Тёмная", icon: IconMoon },
  { value: "system", label: "Система", icon: IconDevice },
];

// Сегментированный переключатель (для экрана «Настройки»).
export function ThemeSwitcher() {
  const { pref, setPref } = useTheme();
  return (
    <div className="theme-switch" role="group" aria-label="Тема оформления">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          className={`theme-opt${pref === value ? " active" : ""}`}
          aria-pressed={pref === value}
          onClick={() => setPref(value)}
        >
          <Icon />
          {label}
        </button>
      ))}
    </div>
  );
}

// Компактная иконка-переключатель (для сайдбара): по кругу свет → тьма → система.
export function ThemeToggle() {
  const { pref, setPref } = useTheme();
  const next: Record<ThemePref, ThemePref> = {
    light: "dark",
    dark: "system",
    system: "light",
  };
  const Icon =
    pref === "light" ? IconSun : pref === "dark" ? IconMoon : IconDevice;
  const titles: Record<ThemePref, string> = {
    light: "Тема: светлая",
    dark: "Тема: тёмная",
    system: "Тема: системная",
  };
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setPref(next[pref])}
      title={titles[pref]}
      aria-label={titles[pref]}
    >
      <Icon />
    </button>
  );
}
