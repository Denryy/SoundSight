import { useEffect, useState } from "react";

import { Sidebar } from "./components/Sidebar";
import { ErrorBanner } from "./components/ErrorBanner";
import { Home } from "./screens/Home";
import { Subtitles } from "./screens/Subtitles";
import { Summary } from "./screens/Summary";
import { History } from "./screens/History";
import { Settings } from "./screens/Settings";
import { AvatarLab } from "./screens/AvatarLab";
import { useSession } from "./state/SessionContext";

export type Screen = "home" | "subtitles" | "summary" | "history" | "lab" | "settings";

const SCREEN_KEY = "soundsight.screen";
const SCREENS: Screen[] = ["home", "subtitles", "summary", "history", "lab", "settings"];

// Восстановить последний открытый экран — чтобы обновление страницы не сбрасывало
// на главную.
function readScreen(): Screen {
  const s = localStorage.getItem(SCREEN_KEY);
  return s && SCREENS.includes(s as Screen) ? (s as Screen) : "home";
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(readScreen);
  const { summary } = useSession();

  // Запоминаем текущий экран, чтобы пережить перезагрузку.
  useEffect(() => {
    localStorage.setItem(SCREEN_KEY, screen);
  }, [screen]);

  // После остановки сессии и получения резюме — показать экран резюме (ТЗ §5.7).
  useEffect(() => {
    if (summary) setScreen("summary");
  }, [summary]);

  // Экран субтитров держим примонтированным после первого открытия и прячем
  // через CSS, а не размонтируем — иначе из DOM пропадает контейнер CWASA
  // и аватар отрисовывается пустым при возврате на вкладку.
  const [subtitlesMounted, setSubtitlesMounted] = useState(
    () => readScreen() === "subtitles",
  );
  useEffect(() => {
    if (screen === "subtitles") setSubtitlesMounted(true);
  }, [screen]);

  return (
    <div className="app">
      <Sidebar screen={screen} onNavigate={setScreen} />
      <main className="workspace" id="main-content">
        <ErrorBanner />
        {screen === "home" && <Home onNavigate={setScreen} />}
        {subtitlesMounted && (
          <div style={{ display: screen === "subtitles" ? "contents" : "none" }}>
            <Subtitles />
          </div>
        )}
        {screen === "summary" && <Summary />}
        {screen === "history" && <History />}
        {screen === "lab" && <AvatarLab />}
        {screen === "settings" && <Settings />}
      </main>
    </div>
  );
}
