import { useSession } from "../state/SessionContext";

// Регулировка размера субтитров (ТЗ §8: регулируемый размер шрифта).
const MIN = 0.8;
const MAX = 2;
const STEP = 0.1;

export function FontSizeControl() {
  const { fontScale, setFontScale } = useSession();
  const clamp = (v: number) => Math.round(Math.min(MAX, Math.max(MIN, v)) * 10) / 10;

  return (
    <div className="font-control" role="group" aria-label="Размер субтитров">
      <button
        type="button"
        className="font-btn"
        onClick={() => setFontScale(clamp(fontScale - STEP))}
        disabled={fontScale <= MIN}
        aria-label="Уменьшить размер субтитров"
      >
        A−
      </button>
      <span className="font-value" aria-live="polite">
        {Math.round(fontScale * 100)}%
      </span>
      <button
        type="button"
        className="font-btn"
        onClick={() => setFontScale(clamp(fontScale + STEP))}
        disabled={fontScale >= MAX}
        aria-label="Увеличить размер субтитров"
      >
        A+
      </button>
    </div>
  );
}
