// Визуальный индикатор статуса записи (ТЗ §8: не полагаться на звук, всё визуально).
export function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      className={`status-dot${active ? " recording" : ""}`}
      role="img"
      aria-label={active ? "Идёт запись" : "Запись остановлена"}
    />
  );
}
