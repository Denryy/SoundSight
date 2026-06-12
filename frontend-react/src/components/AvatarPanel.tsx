import { useEffect, useRef, useState } from "react";

import { nativeAvatar } from "../avatar3d/player";
import { avatarEngine, type AvatarEngineKind } from "../integration/avatarEngine";
import { cwasa } from "../integration/cwasa";
import { useSession } from "../state/SessionContext";

// Панель жестового аватара с переключателем движков (ТЗ §6.6):
//   «Свой 3D» — собственный аватар (three.js, avatar3d/), играет pose-track
//   «CWASA»   — внешний движок SiGML (vhg.cmp.uea.ac.uk)
// ВАЖНО: контейнеры CWASA (.CWASAAvatar/.CWASAAvMenu) остаются в DOM всегда
// и только прячутся классом — иначе движок теряет свой canvas/меню.
export function AvatarPanel() {
  const { avatarReady, active } = useSession();
  const [engine, setEngine] = useState<AvatarEngineKind>(avatarEngine.getEngine());
  const nativeRef = useRef<HTMLDivElement>(null);

  useEffect(() => avatarEngine.onEngineChange(setEngine), []);

  // Инициализировать CWASA только когда контейнер уже в DOM (после монтирования
  // этого компонента) — иначе движок не найдёт `.CWASAAvatar` при сканировании.
  useEffect(() => {
    cwasa.init();
    // Повторный скан после того, как раскладка точно посчитана — чтобы CWASA
    // создал canvas по реальному размеру контейнера, а не 0×0.
    const t = window.setTimeout(() => cwasa.init(), 500);
    return () => clearTimeout(t);
  }, []);

  // Собственный аватар: примонтировать canvas и подгрузить лексикон глоссов.
  useEffect(() => {
    avatarEngine.ensureLexicon();
    if (nativeRef.current) nativeAvatar.attach(nativeRef.current);
    return () => nativeAvatar.detach();
  }, []);

  return (
    <section className="avatar-panel" aria-label="Жестовый аватар">
      <div className="avatar-head">
        <h2 className="panel-title">Жестовый перевод</h2>
        <span
          className={`avatar-badge${avatarReady ? " ready" : ""}${active ? " live" : ""}`}
        >
          {avatarReady ? (active ? "В эфире" : "Готов") : "Загрузка аватара…"}
        </span>
      </div>

      <div className="avatar-engine-switch" role="group" aria-label="Движок аватара">
        <button
          type="button"
          className={engine === "native" ? "on" : ""}
          onClick={() => avatarEngine.setEngine("native")}
          aria-pressed={engine === "native"}
        >
          Свой 3D
        </button>
        <button
          type="button"
          className={engine === "cwasa" ? "on" : ""}
          onClick={() => avatarEngine.setEngine("cwasa")}
          aria-pressed={engine === "cwasa"}
        >
          CWASA
        </button>
      </div>

      <div className={`avatar-pick${engine === "cwasa" ? "" : " is-hidden"}`}>
        <span className="avatar-pick-label">Аватар</span>
        {/* Родное меню CWASA: движок сам вставит сюда <select> с аватарами и
            переключает их (как на сайте CWASA). Контейнер — span, НЕ select. */}
        <span className="CWASAAvMenu av0 avatar-menu" aria-label="Выбор аватара" />
      </div>

      <div className="avatar-stage">
        {/* Контейнер, в который рендерит CWASA. Не трогать содержимое вручную. */}
        <div className={`CWASAAvatar av0${engine === "cwasa" ? "" : " is-hidden"}`} />
        {/* Сцена собственного 3D-аватара (canvas создаёт avatar3d/player). */}
        <div
          ref={nativeRef}
          className={`avatar3d-host${engine === "native" ? "" : " is-hidden"}`}
          aria-label="Собственный 3D-аватар"
        />
        {!avatarReady && (
          <div className="avatar-placeholder" aria-hidden="true">
            <div className="avatar-spinner" />
            <span>Подключение аватара…</span>
          </div>
        )}
      </div>
    </section>
  );
}
