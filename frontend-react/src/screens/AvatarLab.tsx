import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { NativeAvatarController } from "../avatar3d/player";
import { ASL_ALPHABET, RU_ALPHABET } from "../avatar3d/poses";
import type { NativeLexicon, Pose } from "../avatar3d/poseTypes";
import { CameraMirror } from "../integration/cameraMirror";
import { PoseRecorder } from "../integration/poseRecorder";

// «Аватар-лаб» — мастерская собственного 3D-аватара:
//   • Дактиль — предпросмотр букв обоих алфавитов и дактилирование слова;
//   • Глоссы  — проигрывание клипов из avatar/native_lexicon.json (с бэкенда);
//   • Поза    — слайдеры суставов → готовый JSON позы для лексикона.
// Экран создаёт СВОЙ экземпляр контроллера (не синглтон!): экран «Субтитры»
// держится примонтированным, и его canvas отбирать нельзя.

type Tab = "letters" | "gloss" | "pose" | "mirror";

const GLOSS_RE = /^[a-z0-9_-]{1,40}$/;

interface DatasetEntry {
  ru?: string;
  takes: number;
}
interface DatasetManifest {
  target_takes: number;
  glosses: Record<string, DatasetEntry>;
}

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
  // useRef (не useMemo): useMemo может пересоздать значение, а контроллер —
  // тяжёлый stateful-ресурс (WebGL/RAF). Ленивая инициализация даёт ровно один
  // экземпляр на жизнь компонента (без дублей/утечек при StrictMode).
  const ctrlRef = useRef<NativeAvatarController | null>(null);
  if (!ctrlRef.current) ctrlRef.current = new NativeAvatarController();
  const ctrl = ctrlRef.current;
  const stageRef = useRef<HTMLDivElement>(null);

  const [tab, setTab] = useState<Tab>("letters");
  const [alpha, setAlpha] = useState<"ru" | "asl">("ru");
  const [word, setWord] = useState("привет");
  const [lex, setLex] = useState<NativeLexicon | null>(null);
  const [lexError, setLexError] = useState(false);
  const [vals, setVals] = useState<Record<string, number>>({ ...DEFAULTS });
  const [copied, setCopied] = useState(false);

  // ── Зеркало и запись ────────────────────────────────────────────────────
  const mirrorRef = useRef<CameraMirror | null>(null);
  const recorderRef = useRef(new PoseRecorder());
  const videoWrapRef = useRef<HTMLDivElement>(null);
  const framesRef = useRef(0);
  const detectedRef = useRef(false);
  const armDbgRef = useRef(""); // диагностика ориентации правой кисти (tw/wr)
  const [debug, setDebug] = useState("");
  const [mirrorOn, setMirrorOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const [swap, setSwap] = useState(false);
  const [handCopied, setHandCopied] = useState(false);
  const [glossId, setGlossId] = useState("");
  const [glossRu, setGlossRu] = useState("");
  const [status, setStatus] = useState("");
  const [manifest, setManifest] = useState<DatasetManifest>({ target_takes: 10, glosses: {} });

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

  // ── Зеркало: загрузка счётчиков датасета, запуск/останов камеры ──────────
  const loadCounts = useCallback(async () => {
    try {
      const r = await fetch("/avatar/dataset");
      if (r.ok) setManifest((await r.json()) as DatasetManifest);
    } catch {
      /* бэкенд недоступен — счётчики останутся нулевыми */
    }
  }, []);

  const stopCamera = useCallback(() => {
    const cam = mirrorRef.current;
    if (cam) {
      cam.stop();
      cam.video.remove();
      cam.overlay.remove();
    }
    mirrorRef.current = null;
    recorderRef.current.stop();
    setMirrorOn(false);
    setRecording(false);
    ctrl.stopMirror();
  }, [ctrl]);

  const startCamera = useCallback(async () => {
    if (mirrorRef.current) return;
    framesRef.current = 0;
    detectedRef.current = false;
    const cam = new CameraMirror({
      onPose: (pose, hands) => {
        if (mirrorRef.current !== cam) return; // кадр от уже остановленной/заменённой камеры
        framesRef.current += 1;
        detectedRef.current = !!pose;
        if (!pose) return;
        armDbgRef.current = hands?.r ? "кисть: базис-кватернион ✓" : "кисть: —";
        ctrl.applyLivePose(pose, hands);
        recorderRef.current.push(pose, performance.now());
      },
      onStatus: (m) => setStatus(m),
      onError: (m) => setStatus(m),
      swapHands: swap,
    });
    Object.assign(cam.video.style, {
      transform: "scaleX(-1)", // зеркальный показ (как в зеркале)
      width: "100%",
      borderRadius: "12px",
      display: "block",
    });
    videoWrapRef.current?.appendChild(cam.video);
    // Оверлей графа кисти поверх видео — та же зеркальная трансформация, чтобы
    // точки совпадали с картинкой; клики сквозь него.
    Object.assign(cam.overlay.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      transform: "scaleX(-1)",
      pointerEvents: "none",
      borderRadius: "12px",
    });
    videoWrapRef.current?.appendChild(cam.overlay);
    mirrorRef.current = cam;
    setStatus("Запуск камеры…");
    const ok = await cam.start();
    if (mirrorRef.current !== cam) return; // отменили, пока грузилось
    if (!ok) {
      cam.video.remove();
      cam.overlay.remove();
      mirrorRef.current = null;
      setMirrorOn(false);
      ctrl.stopMirror(); // не оставлять контроллер в live-режиме после провала старта
      return; // onError уже выставил статус
    }
    setMirrorOn(true);
    setStatus("Камера активна — аватар повторяет за вами");
  }, [ctrl, swap]);

  const toggleSwap = () => {
    setSwap((s) => {
      const ns = !s;
      mirrorRef.current?.setSwapHands(ns);
      return ns;
    });
  };

  // Экспорт сырых ориентиров кисти (для воспроизведения в симуляции и точной
  // отладки ориентации без камеры). Дублируем в консоль на случай http (буфер).
  const copyHandDebug = async () => {
    const raw = mirrorRef.current?.getLastRaw();
    if (!raw || raw.length === 0) {
      setStatus("Кисть не распознана — покажите руку в кадр");
      return;
    }
    const json = JSON.stringify(raw);
    console.log("HAND_DEBUG", json);
    try {
      await navigator.clipboard.writeText(json);
      setHandCopied(true);
      window.setTimeout(() => setHandCopied(false), 1600);
    } catch {
      setStatus("Буфер недоступен — JSON в консоли (F12), скопируйте оттуда");
    }
  };


  const toggleRecord = useCallback(async () => {
    const g = glossId.trim().toLowerCase();
    if (!mirrorRef.current) {
      setStatus("Сначала включите камеру");
      return;
    }
    if (!GLOSS_RE.test(g)) {
      setStatus("Метка жеста: только a–z, 0–9, дефис, _");
      return;
    }
    if (!recorderRef.current.isRecording()) {
      recorderRef.current.start(performance.now());
      setRecording(true);
      setStatus("● Идёт запись — показывайте жест");
      return;
    }
    const clip = recorderRef.current.stop();
    setRecording(false);
    if (!clip) {
      setStatus("Запись слишком короткая — повторите");
      return;
    }
    setStatus("Сохранение…");
    try {
      const res = await fetch("/avatar/dataset/clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gloss: g, ru: glossRu.trim() || undefined, clip }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { take: number; target: number };
      setStatus(`Сохранено: ${g} — запись ${data.take}/${data.target}`);
      await loadCounts();
    } catch (e) {
      setStatus(`Ошибка сохранения: ${(e as Error).message}`);
    }
  }, [glossId, glossRu, loadCounts]);

  // Счётчики датасета — при монтировании экрана.
  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  // Покидая вкладку «Зеркало» — гасим камеру (поток не должен жить в фоне).
  useEffect(() => {
    if (tab !== "mirror") stopCamera();
  }, [tab, stopCamera]);

  // Размонтирование экрана — освобождаем камеру (ctrl.dispose() — отдельно).
  useEffect(() => () => mirrorRef.current?.stop(), []);

  // Живой индикатор детекции (кадры/поза) — чтобы видеть состояние без консоли.
  useEffect(() => {
    if (!mirrorOn) {
      setDebug("");
      return undefined;
    }
    const id = window.setInterval(() => {
      setDebug(
        `кадров: ${framesRef.current} · поза: ${detectedRef.current ? "✓ распознана" : "— не вижу"} · ${armDbgRef.current}`,
      );
    }, 300);
    return () => window.clearInterval(id);
  }, [mirrorOn]);

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
                ["mirror", "Зеркало"],
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

          {tab === "mirror" && (
            <div className="lab-section">
              <p className="lab-note">
                Включите камеру — аватар повторяет ваши жесты. Чтобы собрать
                датасет: введите метку жеста и жмите «Запись» — аватар повторяет,
                а его движения записываются (по {manifest.target_takes} на жест).
                Если руки перепутаны — переключите «поменять руки».
              </p>

              <div className="lab-row">
                <button
                  type="button"
                  className={mirrorOn ? "lab-secondary" : "lab-primary"}
                  onClick={() => (mirrorOn ? stopCamera() : void startCamera())}
                >
                  {mirrorOn ? "Выключить камеру" : "Включить камеру"}
                </button>
                <label className="lab-swap">
                  <input type="checkbox" checked={swap} onChange={toggleSwap} />
                  поменять руки
                </label>
                {mirrorOn && (
                  <button type="button" className="lab-secondary" onClick={copyHandDebug}>
                    {handCopied ? "Скопировано ✓" : "Копировать кисть (debug)"}
                  </button>
                )}
              </div>

              <div ref={videoWrapRef} className="mirror-preview" aria-label="Превью камеры" />
              {mirrorOn && (
                <p className="lab-note" style={{ fontSize: 12 }}>
                  Граф кисти MediaPipe поверх видео: <span style={{ color: "#22d3ee" }}>● правая</span>{" "}
                  · <span style={{ color: "#f59e0b" }}>● левая</span>. Сравнивайте граф с аватаром
                  при калибровке.
                </p>
              )}

              <div className="lab-row lab-spell">
                <input
                  type="text"
                  value={glossId}
                  onChange={(e) => setGlossId(e.target.value)}
                  placeholder="метка жеста (hello)"
                  aria-label="Метка жеста (латиницей)"
                />
                <input
                  type="text"
                  value={glossRu}
                  onChange={(e) => setGlossRu(e.target.value)}
                  placeholder="по-русски (привет)"
                  aria-label="Русская метка жеста"
                />
              </div>

              <div className="lab-row">
                <button
                  type="button"
                  className={recording ? "lab-rec on" : "lab-rec"}
                  disabled={!mirrorOn}
                  onClick={() => void toggleRecord()}
                >
                  {recording ? "■ Стоп и сохранить" : "● Запись"}
                </button>
                {glossId.trim() && (
                  <span className="lab-take-count">
                    {manifest.glosses[glossId.trim().toLowerCase()]?.takes ?? 0} / {manifest.target_takes}
                  </span>
                )}
              </div>

              {status && (
                <p className="lab-note" role="status">
                  {status}
                </p>
              )}
              {mirrorOn && debug && (
                <p className="lab-note" style={{ fontFamily: "var(--font-mono)" }}>
                  {debug}
                </p>
              )}

              {Object.keys(manifest.glosses).length > 0 && (
                <div className="lab-glosses">
                  {Object.entries(manifest.glosses).map(([id, e]) => (
                    <button
                      key={id}
                      type="button"
                      className="lab-gloss"
                      onClick={() => {
                        setGlossId(id);
                        if (e.ru) setGlossRu(e.ru);
                      }}
                    >
                      <span className="lab-gloss-id">{id}</span>
                      <span className="lab-gloss-ru">
                        {e.takes}/{manifest.target_takes}
                        {e.ru ? ` · ${e.ru}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
