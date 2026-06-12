import { useSession } from "../state/SessionContext";

// Ключевые слова текущей фразы (ТЗ §4.2) — приходят в финальном сообщении.
export function KeywordTags() {
  const { keywords } = useSession();
  if (!keywords.length) return null;
  return (
    <div className="keyword-tags" aria-label="Ключевые слова">
      {keywords.map((w, i) => (
        <span key={`${w}-${i}`} className="keyword-tag">
          {w}
        </span>
      ))}
    </div>
  );
}
