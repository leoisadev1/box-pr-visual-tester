// Renders the blog stills at 2x: architecture, terminals, and the before/after comparisons.
// Run after capture-real-run.ts and the PR #1 run, since the pages read their metrics and PNGs.
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { serveDirectory } from "./preview-server.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HOST = "127.0.0.1";
const PORT = 3042;

const STILLS = [
  { page: "render/architecture.html", out: "artifacts/02-architecture-flow.png", width: 1600 },
  { page: "render/terminal.html?run=snapshot", out: "artifacts/03-snapshot-creation-terminal.png", width: 1400 },
  { page: "render/terminal.html?run=pr", out: "artifacts/04-dual-server-boot-terminal.png", width: 1400 },
  { page: "render/compare.html?view=desktop", out: "artifacts/05-box-browser-desktop-comparison.png", width: 1600 },
  { page: "render/compare.html?view=mobile", out: "artifacts/06-box-browser-mobile-regression.png", width: 1500 },
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
