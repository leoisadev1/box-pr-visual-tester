// Renders artifacts/architecture-flow.png and artifacts/pr-comment-rendered.png at 2x.
// Run after capture-real-run.ts, since the comment reads its metrics and screenshots.
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { serveDirectory } from "./preview-server.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HOST = "127.0.0.1";
const PORT = 3042;

const STILLS = [
  { page: "render/architecture.html", out: "artifacts/02-architecture-flow.png", width: 1600 },
  { page: "render/pr-comment.html", out: "artifacts/pr-comment-rendered.png", width: 1240 },
] as const;

const server = await serveDirectory({ root: ROOT, host: HOST, port: PORT });
const browser = await chromium.launch();
try {
  for (const still of STILLS) {
    const page = await browser.newPage({ viewport: { width: still.width, height: 2400 }, deviceScaleFactor: 2 });
    await page.goto(`http://${HOST}:${PORT}/${still.page}`);
    await page.waitForSelector("body[data-ready='1']");
    const box = await page.locator(".page").boundingBox();
    if (!box) throw new Error(`${still.page} has no .page element`);
    await page.screenshot({ path: join(ROOT, still.out), clip: box });
    await page.close();
    console.info(`${still.out} ${Math.round(box.width * 2)}x${Math.round(box.height * 2)}`);
  }
} finally {
  await browser.close();
  server.close();
}
