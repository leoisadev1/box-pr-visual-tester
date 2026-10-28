// Runs the probe in a local Chromium instead of Box Browser. Used when no Upstash Box key is set:
// on a GitHub Actions runner, and for the fixture capture on a dev machine.
import { chromium, type Browser } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { SHOT_FILES, type Log } from "./box-stages.js";
import { annotate, inspectCheckout, VIEWPORTS, type CheckoutReport, type Viewport } from "./probe.js";
import type { BranchRun } from "./report.js";

export interface LocalPreview {
  label: string;
  url: string;
}

async function inspectAt({
  browser,
  url,
  viewport,
  shotPath,
}: {
  browser: Browser;
  url: string;
  viewport: Viewport;
  shotPath: string;
}): Promise<CheckoutReport> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    isMobile: viewport.name === "mobile",
    hasTouch: viewport.name === "mobile",
  });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    const report = await inspectCheckout({
      page,
      viewport,
      openCheckout: () => page.getByRole("button", { name: "Upgrade Plan" }).click(),
    });
    await annotate(page, report);
    await page.screenshot({ path: shotPath });
    return report;
  } finally {
    await context.close();
  }
}

/** Inspects base and head at mobile and desktop and writes the four screenshots to `dir`. */
export async function inspectLocally({
  before,
  after,
  dir,
  log,
}: {
  before: LocalPreview;
  after: LocalPreview;
  dir: string;
  log: Log;
}): Promise<{ before: BranchRun; after: BranchRun; chromium: string }> {
  await mkdir(dir, { recursive: true });
  const browser = await chromium.launch();
  try {
    const [mobile, desktop] = VIEWPORTS;
    const one = async (preview: LocalPreview, shots: { mobile: string; desktop: string }): Promise<BranchRun> => {
      const reports = {
        mobile: await inspectAt({ browser, url: preview.url, viewport: mobile, shotPath: join(dir, shots.mobile) }),
        desktop: await inspectAt({ browser, url: preview.url, viewport: desktop, shotPath: join(dir, shots.desktop) }),
      };
      for (const r of Object.values(reports)) {
        log(
          `${preview.label.padEnd(6)} ${r.viewport.name.padEnd(7)} ${r.viewport.width}x${r.viewport.height} ${r.status.toUpperCase()} ` +
            `bottom=${Math.round(r.cta.rect.bottom * 10) / 10}px below_fold=${r.cta.overflowBelowFoldPx}px ` +
            `visible=${r.cta.visiblePercent}% submit=${r.submit.kind} console_errors=${r.consoleErrors.length}`,
        );
      }
      return { label: preview.label, reports };
    };
    return {
      before: await one(before, { mobile: SHOT_FILES.beforeMobile, desktop: SHOT_FILES.beforeDesktop }),
      after: await one(after, { mobile: SHOT_FILES.afterMobile, desktop: SHOT_FILES.afterDesktop }),
      chromium: browser.version(),
    };
  } finally {
    await browser.close();
  }
}
