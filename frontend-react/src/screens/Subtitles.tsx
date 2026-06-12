import { AvatarPanel } from "../components/AvatarPanel";
import { SubtitleStream } from "../components/SubtitleStream";
import { SubtitleRail } from "../components/SubtitleRail";
import { SessionControls } from "../components/SessionControls";
import { LangSwitcher } from "../components/LangSwitcher";
import { FontSizeControl } from "../components/FontSizeControl";

// Ключевой экран (ТЗ §4.2): аватар + поток субтитров + панель сессии.
// Управление записью — здесь, в тулбаре (запись начинают с этого экрана).
export function Subtitles() {
  return (
    <div className="screen subtitles-screen">
      <div className="subtitles-toolbar">
        <SessionControls />
        <div className="subtitles-toolbar-right">
          <LangSwitcher />
          <FontSizeControl />
        </div>
      </div>

      <div className="subtitles-layout">
        <AvatarPanel />

        <section className="subtitle-pane" aria-label="Субтитры">
          <div className="panel-head">
            <h2 className="panel-title">Субтитры</h2>
          </div>
          <SubtitleStream />
        </section>

        <SubtitleRail />
      </div>
    </div>
  );
}
