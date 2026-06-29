// Headless-снимок аватара в заданной позе кисти (симуляционная среда).
//
// Поднимает статический сервер на frontend-react/dist, открывает /sim.html в
// Chromium (Playwright), вызывает window.__sim(preset, side), ждёт схождения и
// сохраняет PNG в ml/sim/shots/. Так аватар можно «увидеть» без камеры.
//
//   node ml/sim/shot.mjs [preset[:side]] ...
//   пресеты: r_palm_up r_back_up l_palm_up   (по умолчанию r_palm_up)

import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, "../../frontend-react/dist");
const SHOTS = path.resolve(HERE, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm",
  ".glb": "model/gltf-binary", ".task": "application/octet-stream",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2",
};

function serve(dir) {
  return new Promise((res) => {
    const srv = http.createServer((req, rep) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/index.html";
      const fp = path.join(dir, p);
      if (!fp.startsWith(dir) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        rep.writeHead(404); rep.end("404"); return;
      }
      rep.writeHead(200, { "Content-Type": MIME[path.extname(fp)] ?? "application/octet-stream" });
      fs.createReadStream(fp).pipe(rep);
    });
    srv.listen(0, () => res(srv));
  });
}

const presets = process.argv.slice(2);
if (presets.length === 0) presets.push("r_palm_up");

const srv = await serve(DIST);
const port = srv.address().port;
const browser = await chromium.launch({
  executablePath: chromium.executablePath(), // полный Chromium (headless-shell не качали)
  args: ["--use-gl=swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
page.on("console", (m) => console.log("  [page]", m.text()));
page.on("pageerror", (e) => console.log("  [page ERROR]", e.message));

await page.goto(`http://localhost:${port}/sim.html`, { waitUntil: "load" });
await page.waitForTimeout(3500); // дать догрузиться скиновой модели (.glb)

for (const arg of presets) {
  const [preset, side] = arg.split(":");
  const msg = await page.evaluate(([p, s]) => window.__sim?.(p, s || undefined), [preset, side]);
  console.log(`→ ${arg}: ${msg}`);
  await page.waitForTimeout(1300); // схождение live-фильтра
  const out = path.join(SHOTS, `${arg.replace(":", "_")}.png`);
  await page.screenshot({ path: out });
  console.log(`  saved ${out}`);
}

await browser.close();
srv.close();
console.log("done");
