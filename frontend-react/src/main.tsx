import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { SessionProvider } from "./state/SessionContext";
import "./integration/theme"; // применяет сохранённую/системную тему до первого рендера
import "./styles/theme.css";
import "./styles/global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SessionProvider>
      <App />
    </SessionProvider>
  </StrictMode>,
);
