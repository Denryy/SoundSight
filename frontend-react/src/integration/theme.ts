// Управление темой: светлая | тёмная | системная (по устройству).
// Применяет data-theme на <html>, сохраняет выбор и следит за системной темой.

export type ThemePref = "light" | "dark" | "system";

const KEY = "soundsight.theme";
const mq = window.matchMedia("(prefers-color-scheme: dark)");

function readPref(): ThemePref {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

class ThemeController {
  private pref: ThemePref = readPref();
  private listeners = new Set<(p: ThemePref) => void>();

  constructor() {
    // Системная тема может смениться на лету (день/ночь, переключение в ОС).
    mq.addEventListener("change", () => {
      if (this.pref === "system") this.apply();
    });
    this.apply();
  }

  private resolve(): "light" | "dark" {
    if (this.pref === "system") return mq.matches ? "dark" : "light";
    return this.pref;
  }

  private apply(): void {
    document.documentElement.setAttribute("data-theme", this.resolve());
  }

  get(): ThemePref {
    return this.pref;
  }

  resolved(): "light" | "dark" {
    return this.resolve();
  }

  set(pref: ThemePref): void {
    this.pref = pref;
    localStorage.setItem(KEY, pref);
    this.apply();
    this.listeners.forEach((fn) => fn(pref));
  }

  subscribe(fn: (p: ThemePref) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const theme = new ThemeController();
