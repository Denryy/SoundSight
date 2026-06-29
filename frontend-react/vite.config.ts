import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Бэкенд SoundSight (FastAPI) по умолчанию слушает 127.0.0.1:8000 (core/config.py).
// Меняется через переменную окружения SOUNDSIGHT_BACKEND, напр. SOUNDSIGHT_BACKEND=http://127.0.0.1:9000
const BACKEND = process.env.SOUNDSIGHT_BACKEND ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Проксируем весь контракт интеграции на бэкенд SoundSight — фронт работает с тем же origin.
    proxy: {
      "/session": { target: BACKEND, changeOrigin: true },
      "/sessions": { target: BACKEND, changeOrigin: true },
      "/summary": { target: BACKEND, changeOrigin: true },
      "/avatar": { target: BACKEND, changeOrigin: true },
      "/health": { target: BACKEND, changeOrigin: true },
      // ВНИМАНИЕ: /cwaclientcfg.json НЕ проксируем — его отдаёт Vite из public/
      // (CWASA грузит конфиг с origin страницы). В проде файл отдаёт бэкенд.
      "/ws": { target: BACKEND, changeOrigin: true, ws: true },
    },
  },
  build: {
    outDir: "dist",
    // Бэкенд монтирует ассеты на /assets — совпадает с дефолтом Vite.
    assetsDir: "assets",
    rollupOptions: {
      // Доп. вход — симуляционная страница аватара (sim.html) для headless-проверки.
      input: {
        main: resolve(__dirname, "index.html"),
        sim: resolve(__dirname, "sim.html"),
      },
    },
  },
});
