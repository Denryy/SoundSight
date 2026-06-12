import { useEffect, useRef } from "react";

import { useSession } from "../state/SessionContext";

function IconCaptions() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M7 11h3M7 15h6M14 11h3" />
    </svg>
  );
}

// Поток субтитров (ТЗ §4.2, §6.4):
//  - финальные строки накапливаются с автоскроллом вниз;
//  - промежуточная (interim) строка — визуально отличается (приглушённая, курсив);
//  - до начала речи — информативная заглушка (старт / «слушаю»).
export function SubtitleStream() {
  const { finals, interim, active } = useSession();
  const boxRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Автоскролл вниз при появлении новой строки (ТЗ §9: лёгкий рендер).
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [finals.length, interim]);

  const empty = finals.length === 0 && !interim;

  return (
    <div
      className="subtitle-stream"
      ref={boxRef}
      role="log"
      aria-label="Субтитры в реальном времени"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {empty ? (
        active ? (
          <div className="subtitle-placeholder">
            <div className="subtitle-listening" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <h3 className="subtitle-placeholder-title">Слушаю…</h3>
            <p className="subtitle-placeholder-text">
              Говорите — распознанная речь появится здесь, а ключевые слова
              подсветятся тегами выше.
            </p>
          </div>
        ) : (
          <div className="subtitle-placeholder">
            <div className="subtitle-placeholder-icon" aria-hidden="true">
              <IconCaptions />
            </div>
            <h3 className="subtitle-placeholder-title">Субтитры появятся здесь</h3>
            <p className="subtitle-placeholder-text">
              Нажмите «Начать запись» слева — речь распознаётся в реальном
              времени, переводится в жесты аватара, а в конце соберётся резюме.
            </p>
            <div className="subtitle-placeholder-langs" aria-hidden="true">
              <span className="lang-chip">Авто</span>
              <span className="lang-chip">Русский</span>
              <span className="lang-chip">English</span>
              <span className="lang-chip">Қазақша</span>
            </div>
          </div>
        )
      ) : (
        <>
          {finals.map((line) => (
            <p key={line.id} className="subtitle-line final">
              {line.text}
            </p>
          ))}
          {interim && <p className="subtitle-line interim">{interim}</p>}
        </>
      )}

      <div ref={endRef} />
    </div>
  );
}
