// Форматирование дат для экранов сессий (ру-локаль). Единый источник, чтобы
// «Главная» и «История» не расходились в стиле.

function fmt(iso: string, opts: Intl.DateTimeFormatOptions): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", opts);
}

/** Полная дата: «5 июня 2026, 14:30» — экран «История». */
export const formatDateFull = (iso: string): string =>
  fmt(iso, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Короткая дата: «5 июн, 14:30» — карточки недавних сессий на «Главной». */
export const formatDateShort = (iso: string): string =>
  fmt(iso, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
