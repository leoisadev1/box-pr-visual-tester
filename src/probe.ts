import type { ConsoleMessage, Page } from "playwright-core";

export type ViewportName = "mobile" | "desktop";

export interface Viewport {
  name: ViewportName;
  width: number;
  height: number;
}

export const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const satisfies readonly Viewport[];

export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

export interface CtaMeasurement {
  label: string;
  rect: Rect;
  viewportHeight: number;
  /** How far the button's bottom edge sits below the fold. 0 when it fits. */
  overflowBelowFoldPx: number;
  /** Share of the button's area a user can see, after viewport and overflow clipping. */
  visiblePercent: number;
  /** Element painted over the button's visible center, when something covers it. */
  coveredBy: string | null;
}

export type SubmitAttempt =
  /** `ctaAfter` is measured again once validation settles: a message can push the button away. */
  | { kind: "clicked"; validationMessage: string | null; ctaAfter: CtaMeasurement }
  | { kind: "unreachable"; reason: string };

export interface CheckoutReport {
  viewport: Viewport;
  cta: CtaMeasurement;
  submit: SubmitAttempt;
  consoleErrors: string[];
  status: "pass" | "fail";
}

const CTA_SELECTOR = "#checkout button[type=submit]";

/**
 * Opens the checkout modal, measures the primary button, then submits the form with an empty
 * cardholder name so the validation path runs. `openCheckout` is injected so the Box flow can use
 * a natural-language `tab.act()` while the local capture clicks with Playwright.
 */
export async function inspectCheckout({
  page,
  viewport,
  openCheckout,
}: {
  page: Page;
  viewport: Viewport;
  openCheckout: () => Promise<unknown>;
}): Promise<CheckoutReport> {
  const consoleErrors: string[] = [];
  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  };
  const onPageError = (err: Error) => consoleErrors.push(err.message);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  let cta: CtaMeasurement;
  let submit: SubmitAttempt;
  try {
    await page.reload({ waitUntil: "networkidle" });
    await openCheckout();
    await page.locator("#checkout").waitFor({ state: "visible" });

    cta = await measureCta(page);

    await page.fill("#card", "4242 4242 4242 4242");
    await page.fill("#exp", "12 / 28");
    await page.fill("#cvc", "123");
    await page.fill("#zip", "94107");

    submit = await trySubmit(page);
  } finally {
    // The Box flow reuses one page per branch, so stop listening before the next viewport.
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }
  const fullyVisible = (m: CtaMeasurement) => m.visiblePercent === 100 && m.coveredBy === null;
  const passed =
    fullyVisible(cta) &&
    submit.kind === "clicked" &&
    fullyVisible(submit.ctaAfter) &&
    submit.validationMessage !== null &&
    consoleErrors.length === 0;

  return { viewport, cta, submit, consoleErrors, status: passed ? "pass" : "fail" };
}

async function trySubmit(page: Page): Promise<SubmitAttempt> {
  try {
    await page.locator(CTA_SELECTOR).click({ timeout: 2_000 });
  } catch (err) {
    const reason = err instanceof Error ? err.message.split("\n")[0] ?? err.message : String(err);
    return { kind: "unreachable", reason };
  }
  const error = page.locator("#name-error");
  await error.waitFor({ state: "visible", timeout: 2_000 }).catch(() => undefined);
  const validationMessage = (await error.isVisible()) ? (await error.textContent())?.trim() ?? null : null;
  return { kind: "clicked", validationMessage, ctaAfter: await measureCta(page) };
}

// Runs in the page. Kept free of nested named functions so bundlers do not inject helpers.
async function measureCta(page: Page): Promise<CtaMeasurement> {
  return page.$eval(CTA_SELECTOR, (button) => {
    const r = button.getBoundingClientRect();
    let top = Math.max(r.top, 0);
    let bottom = Math.min(r.bottom, window.innerHeight);
    let left = Math.max(r.left, 0);
    let right = Math.min(r.right, window.innerWidth);
    // Walk up the clipping ancestors. <body> and <html> overflow belongs to the viewport, which is
    // already applied, and nothing above a position:fixed element can clip it.
    for (let el = button.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.overflowX !== "visible" || style.overflowY !== "visible") {
        const clip = el.getBoundingClientRect();
        top = Math.max(top, clip.top);
        bottom = Math.min(bottom, clip.bottom);
        left = Math.max(left, clip.left);
        right = Math.min(right, clip.right);
      }
      if (style.position === "fixed") break;
    }
    const visibleArea = Math.max(0, bottom - top) * Math.max(0, right - left);
    const visiblePercent = Math.round((visibleArea / (r.width * r.height)) * 1000) / 10;

    let coveredBy: string | null = null;
    if (visibleArea > 0) {
      const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      if (hit && hit !== button && !button.contains(hit)) {
        coveredBy = hit.id ? `#${hit.id}` : hit.tagName.toLowerCase();
      }
    }

    return {
      label: button.textContent?.trim() ?? "",
      rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height },
      viewportHeight: window.innerHeight,
      overflowBelowFoldPx: Math.max(0, Math.round((r.bottom - window.innerHeight) * 10) / 10),
      visiblePercent,
      coveredBy,
    };
  });
}

/** Draws the result onto the page so the screenshot explains itself. */
export async function annotate(page: Page, report: CheckoutReport): Promise<void> {
  await page.evaluate(({ r, selector }) => {
    const layer = document.createElement("div");
    layer.setAttribute("data-visual-qa", "");
    layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;font:600 13px/1.3 Inter,system-ui,sans-serif";
    const ok = r.status === "pass";
    const color = ok ? "#16a34a" : "#dc2626";
    // Read the rect live: the validation message can move the button after the first measurement.
    const rect = document.querySelector(selector)?.getBoundingClientRect() ?? r.cta.rect;
    if (r.cta.visiblePercent > 0) {
      const box = document.createElement("div");
      box.style.cssText = `position:absolute;left:${rect.left - 4}px;top:${rect.top - 4}px;width:${rect.width + 8}px;height:${rect.height + 8}px;border:2.5px solid ${color};border-radius:13px;box-shadow:0 0 0 4px ${color}22`;
      layer.append(box);
    }
    if (r.cta.overflowBelowFoldPx > 0) {
      const edge = document.createElement("div");
      edge.style.cssText = `position:absolute;left:0;right:0;bottom:0;height:6px;background:repeating-linear-gradient(135deg,${color} 0 8px,#fca5a5 8px 16px)`;
      layer.append(edge);
    }
    const tag = document.createElement("div");
    tag.textContent = ok
      ? `PASS: CTA ${r.cta.visiblePercent}% visible`
      : `FAIL: CTA clipped ${r.cta.overflowBelowFoldPx}px below the fold`;
    // Top center sits above the dialog on both viewports, so the tag never covers page content.
    tag.style.cssText = `position:absolute;left:50%;top:8px;transform:translateX(-50%);white-space:nowrap;padding:6px 10px;border-radius:8px;background:${color};color:#fff;box-shadow:0 4px 12px rgb(0 0 0 / .18)`;
    layer.append(tag);
    document.body.append(layer);
  }, { r: report, selector: CTA_SELECTOR });
}
