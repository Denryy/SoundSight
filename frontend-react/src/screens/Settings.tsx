import { LangSwitcher } from "../components/LangSwitcher";
import { StatusDot } from "../components/StatusDot";
import { FontSizeControl } from "../components/FontSizeControl";
import { ThemeSwitcher } from "../components/ThemeSwitcher";
import { useSession } from "../state/SessionContext";

// Настройки (ТЗ §4.5): выбор микрофона, язык распознавания, индикатор статуса.
export function Settings() {
  const { mics, selectedMic, setSelectedMic, active, avatarReady } = useSession();

  return (
    <div className="screen settings-screen">
      <h1 className="screen-title">Настройки</h1>

      <section className="settings-card">
        <span className="field-label">Тема оформления</span>
        <ThemeSwitcher />
        <p className="field-hint">«Система» следует за настройкой вашего устройства.</p>
      </section>

      <section className="settings-card">
        <label className="field-label" htmlFor="micSelect">
          Микрофон
        </label>
        <select
          id="micSelect"
          className="field-select"
          value={selectedMic}
          onChange={(e) => setSelectedMic(e.target.value)}
          disabled={active}
        >
          {mics.length === 0 && <option value="">Микрофоны не найдены</option>}
          {mics.map((m, i) => (
            <option key={m.deviceId || i} value={m.deviceId}>
              {m.label || `Микрофон ${i + 1}`}
            </option>
          ))}
        </select>
        {active && (
          <p className="field-hint">Нельзя сменить микрофон во время записи.</p>
        )}
      </section>

      <section className="settings-card">
        <span className="field-label">Язык распознавания</span>
        <LangSwitcher />
        <p className="field-hint">Казахский (KZ) загружает модель ~10 секунд.</p>
      </section>

      <section className="settings-card">
        <span className="field-label">Размер субтитров</span>
        <FontSizeControl />
      </section>

      <section className="settings-card">
        <span className="field-label">Статус</span>
        <div className="status-row">
          <StatusDot active={active} />
          <span>{active ? "Идёт запись" : "Запись остановлена"}</span>
        </div>
        <div className="status-row">
          <span className={`status-dot${avatarReady ? " ready-static" : ""}`} aria-hidden="true" />
          <span>{avatarReady ? "Аватар готов" : "Аватар загружается"}</span>
        </div>
      </section>
    </div>
  );
}
