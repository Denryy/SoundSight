import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { SessionProvider } from "./state/SessionContext";
import "./integration/theme"; // применяет сохранённую/системную тему до первого рендера
import "./styles/theme.css";
import "./styles/global.css";

// Снимок WebAssembly.instantiateStreaming на случай, если инлайн-снимок в
// index.html (он стоит ДО allcsa.js) почему-то не отработал. НЕ перезатираем уже
// снятый оригинал — к моменту main.tsx CWASA мог уже подменить функцию своей
// (см. integration/cameraMirror.ts и комментарий в index.html).
{
  const w = window as unknown as { __origWasmStreaming?: typeof WebAssembly.instantiateStreaming };
  if (
    !w.__origWasmStreaming &&
    typeof WebAssembly !== "undefined" &&
    typeof WebAssembly.instantiateStreaming === "function"
  ) {
    w.__origWasmStreaming = WebAssembly.instantiateStreaming.bind(WebAssembly);
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SessionProvider>
      <App />
    </SessionProvider>
  </StrictMode>,
);
