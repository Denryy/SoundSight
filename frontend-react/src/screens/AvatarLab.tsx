import { useEffect, useMemo, useRef, useState } from "react";

import { NativeAvatarController } from "../avatar3d/player";
import { ASL_ALPHABET, RU_ALPHABET } from "../avatar3d/poses";
import type { NativeLexicon, Pose } from "../avatar3d/poseTypes";

// «Аватар-лаб» — мастерская собственного 3D-аватара:
//   • Дактиль — предпросмотр букв обоих алфавитов и дактилирование слова;
//   • Глоссы  — проигрывание клипов из avatar/native_lexicon.json (с бэкенда);
//   • Поза    — слайдеры суставов → готовый JSON позы для лексикона.
// Экран создаёт СВОЙ экземпляр контроллера (не синглтон!): экран «Субтитры»
// держится примонтированным, и его canvas отбирать нельзя.

type Tab = "letters" | "gloss" | "pose";

const ARM_SLIDERS = [
  { k: "sh0", label: "Плечо: подъём", min: 0, max: 170 },
  { k: "sh1", label: "Плечо: в сторону", min: 0, max: 120 },
  { k: "sh2", label: "Плечо: вращение", min: -90, max: 90 },
  { k: "el", label: "Локоть", min: 0, max: 150 },
  { k: "tw", label: "Предплечье (ладонь)", min: -120, max: 120 },
  { k: "wr0", label: "Кисть: сгиб", min: -70, max: 80 },
  { k: "wr1", label: "Кисть: отклонение", min: -40, max: 40 },
] as const;

const FINGER_SLIDERS = [
  { k: "ci", label: "Указательный" },
  { k: "cm", label: "Средний" },
  { k: "cr", label: "Безымянный" },
  { k: "cp", label: "Мизинец" },
] as const;

const DEFAULTS: Record<string, number> = {
  sh0: 50, sh1: 15, sh2: 0, el: 104, tw: -75, wr0: 0, wr1: 0,
  ci: 0, cm: 0, cr: 0, cp: 0, spread: 0,
  ts: 10, to: 0, tc: 0,
  head: 0,
};

function buildPose(v: Record<string, number>): Pose {
  return {
    rArm: { sh: [v.sh0, v.sh1, v.sh2], el: v.el, tw: v.tw, wr: [v.wr0, v.wr1] },
    rHand: {
      thumb: { spread: v.ts, oppose: v.to, curl: v.tc },
      index: { curl: v.ci, spread: v.spread },
      middle: { curl: v.cm, spread: 0 },
      ring: { curl: v.cr, spread: v.spread * 0.8 },
      pinky: { curl: v.cp, spread: v.spread },
    },
    head: [v.head, 0, 0],
  };
}

export function AvatarLab() {
  const ctrl = useMemo(() => new NativeAvatarController(), []);
  const stageRef = useRef<HTMLDivElement>(null);

  const [tab, setTab] = useState<Tab>("letters");
  const [alpha, setAlpha] = useState<"ru" | "asl">("ru");
  const [word, setWord] = useState("привет");
  const [lex, setLex] = useState<NativeLexicon | null>(null);
  const [lexError, setLexError] = useState(false);
  const [vals, setVals] = useState<Record<string, number>>({ ...DEFAULTS });
  const [copied, setCopied] = useState(false);

  // Сцена: монтируем canvas, при размонтировании освобождаем ресурсы.
  useEffect(() => {
    if (stageRef.current) ctrl.attach(stageRef.current);
    return () => ctrl.dispose();
  }, [ctrl]);

  // Лексикон глоссов — с бэкенда (единый источник правды).
  useEffect(() => {
    let cancelled = false;
    fetch("/avatar/native/lexicon")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: NativeLexicon) => {
        if (cancelled) return;
        setLex(data);
        ctrl.setLexicon(data);
      })
      .catch(() => !cancelled && setLexError(true));
    return () => {
      cancelled = true;
    };
  }, [ctrl]);

  // Режим «Поза»: статичная поза следует за слайдерами; на выходе — в покой.
  useEffect(() => {
    if (tab === "pose") {
      ctrl.applyStaticPose(buildPose(vals));
      return () => ctrl.resumeIdle();
    }
    return undefined;
  }, [tab, vals, ctrl]);

  const pose = useMemo(() => buildPose(vals), [vals]);
  const poseJson = useMemo(() => JSON.stringify(pose, null, 2), [pose]);

  const letters = Object.keys(alpha === "ru" ? RU_ALPHABET : ASL_ALPHABET);

  const spellWord = () => {
    const dict = alpha === "ru" ? RU_ALPHABET : ASL_ALPHABET;
    const ls = word.toLowerCase().split("").filter((c) => c in dict);
    if (ls.length) ctrl.previewSpell(alpha, ls);
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(poseJson);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* буфер недоступен (http) — JSON можно выделить вручную */
    }
  };

  const slider = (k: string, label: string, min: number, max: number) => (
    <label key={k} className="lab-slider">
      <span className="lab-slider-head">
        <span>{label}</span>
        <span className="lab-slider-val">{Math.round(vals[k])}°</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={vals[k]}
        onChange={(e) => setVals((p) => ({ ...p, [k]: Number(e.target.value) }))}
      />
    </label>
  );

  return (
    <div className="screen lab-screen">
      <header>
        <h1 className="screen-title">Аватар-лаб</h1>
        <p className="screen-subtitle">
          Мастерская собственного 3D-аватара: предпросмотр дактиля и жестов,
          подбор поз слайдерами и экспорт JSON для{" "}
          <code>avatar/native_lexicon.json</code>. Формы букв — стартовое
          приближение: доводите их здесь и сверяйте с носителями ЖЯ.
        </p>
      </header>

      <div className="lab-layout">
        <div className="lab-stage-wrap">
          <div ref={stageRef} className="avatar3d-stage" aria-label="Сцена аватара" />
          <button type="button" className="lab-reset" onClick={() => ctrl.resumeIdle()}>
            В позу покоя
          </button>
        </div>

        <div className="lab-controls">
          <div className="lab-tabs" role="tablist" aria-label="Режим лаборатории">
            {(
              [
                ["letters", "Дактиль"],
                ["gloss", "Глоссы"],
                ["pose", "Поза"],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? "on" : ""}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "letters" && (
            <div className="lab-section">
              <div className="lab-row">
                <div className="avatar-engine-switch" role="group" aria-label="Алфавит">
                  <button
                    type="button"
                    className={alpha === "ru" ? "on" : ""}
                    onClick={() => setAlpha("ru")}
                  >
                    Русский
                  </button>
                  <button
                    type="button"
                    className={alpha === "asl" ? "on" : ""}
                    onClick={() => setAlpha("asl")}
                  >
                    ASL
                  </button>
                </div>
              </div>

              <div className="lab-letters" role="group" aria-label="Буквы">
                {letters.map((l) => (
                  <button
                    key={l}
                    type="button"
                    className="lab-letter"
                    onClick={() => ctrl.previewLetter(alpha, l)}
                  >
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>

              <div className="lab-row lab-spell">
                <input
                  type="text"
                  value={word}
                  onChange={(e) => setWord(e.target.value)}
                  placeholder="Слово для дактиля"
                  aria-label="Слово для дактиля"
                />
                <button type="button" className="lab-primary" onClick={spellWord}>
                  Продактилировать
                </button>
              </div>
            </div>
          )}

          {tab === "gloss" && (
            <div className="lab-section">
              {lex ? (
                <div className="lab-glosses">
                  {Object.entries(lex.glosses).map(([id, clip]) => (
                    <button
                      key={id}
                      type="button"
                      className="lab-gloss"
                      onClick={() => ctrl.previewClip(clip.frames, clip.hold ?? 180)}
                    >
                      <span className="lab-gloss-id">{id}</span>
                      {clip.ru && <span className="lab-gloss-ru">{clip.ru}</span>}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="lab-note">
                  {lexError
                    ? "Лексикон не загружен: бэкенд недоступен (GET /avatar/native/lexicon)."
                    : "Загрузка лексикона…"}
                </p>
              )}
            </div>
          )}

          {tab === "pose" && (
            <div className="lab-section">
              <h3 className="lab-group-title">Правая рука</h3>
              {ARM_SLIDERS.map((s) => slider(s.k, s.label, s.min, s.max))}

              <h3 className="lab-group-title">Пальцы (сгиб)</h3>
              {FINGER_SLIDERS.map((s) => slider(s.k, s.label, 0, 110))}
              {slider("spread", "Растопырка", -15, 30)}

              <h3 className="lab-group-title">Большой палец</h3>
              {slider("ts", "Отведение", 0, 60)}
              {slider("to", "Оппозиция", 0, 70)}
              {slider("tc", "Сгиб", 0, 100)}

              <h3 className="lab-group-title">Голова</h3>
              {slider("head", "Кивок", -25, 30)}

              <div className="lab-row">
                <button
                  type="button"
                  className="lab-secondary"
                  onClick={() => setVals({ ...DEFAULTS })}
                >
                  Сбросить
                </button>
                <button type="button" className="lab-primary" onClick={copyJson}>
                  {copied ? "Скопировано ✓" : "Копировать JSON"}
                </button>
              </div>
              <pre className="lab-json" aria-label="JSON позы">
                {poseJson}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
