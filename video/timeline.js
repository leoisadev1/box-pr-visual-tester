// Deterministic timeline for the 28 s demo. window.__setTime(t) paints the frame for t seconds.
// Nothing animates on its own: no CSS transitions, no timers. The renderer steps t at 60 fps.
import { commentHTML, prHeadHTML, ICONS } from "../render/comment.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ramp = (t, a, b) => clamp((t - a) / (b - a));
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const easeOut = (p) => 1 - Math.pow(1 - p, 3);
const SCALE = 0.78;

const m = await (await fetch("../artifacts/run-metrics.json")).json();
const before = m.measured.before.reports.mobile;
const after = m.measured.after.reports.mobile;
const r1 = (n) => Math.round(n * 10) / 10;

// Static content
$("s1-head").innerHTML = prHeadHTML({ avatar: "../assets/leodev.png" });
$("s2-logo").innerHTML = ICONS.box;
$("s2-claude").innerHTML = ICONS.claude;
$("tag-claude").innerHTML = ICONS.claude;
$("s3-wrap").innerHTML =
  prHeadHTML({ avatar: "../assets/leodev.png" }) +
  commentHTML({ m, shots: { before: "../artifacts/before-mobile.png", after: "../artifacts/after-mobile.png" }, shotWidth: 252 });
const CHECK = `<svg width="12" height="12" viewBox="0 0 12 12"><path d="m2.5 6.2 2.3 2.3 4.7-4.8" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CROSS = `<svg width="12" height="12" viewBox="0 0 12 12"><path d="m3.2 3.2 5.6 5.6m0-5.6-5.6 5.6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>`;
for (const el of document.querySelectorAll("[data-icon]")) el.innerHTML = el.dataset.icon === "ok" ? CHECK : CROSS;
$("b-measure").textContent = `bottom ${r1(before.cta.rect.bottom)}px, fold ${before.cta.viewportHeight}px: ${r1(before.cta.overflowBelowFoldPx)}px below`;
$("b-verdict-sub").textContent = `"${before.cta.label}" ends ${r1(before.cta.overflowBelowFoldPx)}px below the fold, ${before.cta.visiblePercent}% visible.`;
$("a-validation").textContent = `Shows "${after.submit.validationMessage}"`;
$("a-measure").textContent = `bottom ${r1(after.cta.rect.bottom)}px, ${after.cta.visiblePercent}% visible, not covered`;
$("a-verdict-sub").textContent = "Dialog scrolls inside 85dvh and the footer stays pinned.";
$("tel-box").textContent = m.box.boxId;
$("tel-restore").textContent = `${m.box.snapshotRestoreSeconds}s`;

// Fixture iframes
async function ready(iframe) {
  if (iframe.contentDocument?.readyState !== "complete" || !iframe.contentWindow.__checkout) {
    await new Promise((done) => iframe.addEventListener("load", done, { once: true }));
  }
  await iframe.contentDocument.fonts.ready;
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  const q = (s) => doc.querySelector(s);
  return {
    iframe,
    setOpen(open) {
      if (open === q("#checkout").hidden) open ? win.__checkout.openCheckout() : win.__checkout.closeCheckout();
    },
    setValues(values) {
      for (const [id, value] of Object.entries(values)) if (q(`#${id}`).value !== value) q(`#${id}`).value = value;
    },
    setSubmitted(submitted) {
      const shown = !q("#name-error").hidden;
      if (submitted && !shown) win.__checkout.submit();
      if (!submitted && shown) {
        q("#name-error").hidden = true;
        q("#name").setAttribute("aria-invalid", "false");
      }
    },
    /** Rect of a selector in stage coordinates. */
    rect(selector) {
      const f = iframe.getBoundingClientRect();
      const r = q(selector).getBoundingClientRect();
      return { left: f.left + r.left * SCALE, top: f.top + r.top * SCALE, width: r.width * SCALE, height: r.height * SCALE };
    },
  };
}
const fb = await ready($("f-before"));
const fa = await ready($("f-after"));
await document.fonts.ready;
await Promise.all([...document.images].map((img) => img.decode()));

const center = (r, dx = 0, dy = 0) => ({ x: r.left + r.width / 2 + dx, y: r.top + r.height / 2 + dy });
const upgradeB = center(fb.rect("#upgrade"));
const upgradeA = center(fa.rect("#upgrade"));
fb.setOpen(true);
fa.setOpen(true);
const ctaB = fb.rect("#confirm");
const cardA = center(fa.rect("#card"), -40);
const ctaA = center(fa.rect("#confirm"), 30);
fb.setOpen(false);
fa.setOpen(false);
const runBtn = center($("run-btn").getBoundingClientRect(), -10, 2);
$("s3").style.opacity = "1";
const costEl = document.querySelector("#s3 .cost");
const costR = costEl.getBoundingClientRect();
const costPt = { x: costR.left + costR.width * 0.62, y: costR.top + costR.height * 0.62 };
$("s3").style.opacity = "0";

// Before pane overlay: fold line and the clipped button drawn where it really sits.
const paneB = $("pane-before");
const pb = paneB.getBoundingClientRect();
const vp = paneB.querySelector(".viewport").getBoundingClientRect();
const fold = Object.assign(document.createElement("div"), { className: "fold" });
fold.style.cssText = `left:${vp.left - pb.left - 10}px;width:${vp.width + 20}px;top:${vp.bottom - pb.top}px`;
const ghost = Object.assign(document.createElement("div"), { className: "ghost" });
ghost.style.cssText = `left:${ctaB.left - pb.left}px;top:${ctaB.top - pb.top}px;width:${ctaB.width}px;height:${ctaB.height}px`;
const ghostLabel = Object.assign(document.createElement("div"), { className: "ghost-label" });
ghostLabel.textContent = `"${before.cta.label}" is ${r1(before.cta.overflowBelowFoldPx)}px below the ${before.cta.viewportHeight}px fold`;
ghostLabel.style.cssText = `left:${ctaB.left - pb.left}px;top:${ctaB.top + ctaB.height - pb.top + 6}px`;
paneB.append(fold, ghost, ghostLabel);
const ghostCenter = center(ctaB);

const paneA = $("pane-after");
const hit = Object.assign(document.createElement("div"), { className: "hit" });
paneA.append(hit);

// Typing schedule for the PR pane (the probe fills these fields before submitting).
const CPS = 32;
const TYPING = [
  { id: "card", text: "4242 4242 4242 4242", start: 12.75 },
  { id: "exp", text: "12 / 28", start: 13.42 },
  { id: "cvc", text: "123", start: 13.7 },
  { id: "zip", text: "94107", start: 13.85 },
];
const typed = (t) =>
  Object.fromEntries(TYPING.map((f) => [f.id, f.text.slice(0, clamp(Math.floor((t - f.start) * CPS) + 1, 0, f.text.length))]));

// Cursor path: [time, point]. Moves ease between keyframes and hold otherwise.
const PATH = [
  [0.9, { x: 1560, y: 1010 }],
  [2.35, runBtn],
  [3.7, runBtn],
  [4.5, { x: runBtn.x + 70, y: runBtn.y + 86 }],
  [7.6, { x: runBtn.x + 70, y: runBtn.y + 86 }],
  [7.95, { x: 960, y: 640 }],
  [8.95, upgradeB],
  [9.55, upgradeB],
  [10.3, ghostCenter],
  [11.2, ghostCenter],
  [12.05, upgradeA],
  [12.3, upgradeA],
  [12.62, cardA],
  [14.05, cardA],
  [14.4, ctaA],
  [15.7, ctaA],
  [16.4, { x: ctaA.x + 120, y: ctaA.y + 70 }],
  [19.6, { x: ctaA.x + 120, y: ctaA.y + 70 }],
  [22.45, { x: 1620, y: 1030 }],
  [23.6, costPt],
];
const CLICKS = [
  { t: 2.6, at: runBtn },
  { t: 9.1, at: upgradeB },
  { t: 10.45, at: ghostCenter, miss: true },
  { t: 12.2, at: upgradeA },
  { t: 12.64, at: cardA },
  { t: 14.45, at: ctaA },
];
function cursorAt(t) {
  if (t <= PATH[0][0]) return PATH[0][1];
  for (let i = 1; i < PATH.length; i++) {
    const [t1, p1] = PATH[i];
    const [t0, p0] = PATH[i - 1];
    if (t <= t1) {
      const p = easeInOut(ramp(t, t0, t1));
      return { x: p0.x + (p1.x - p0.x) * p, y: p0.y + (p1.y - p0.y) * p };
    }
  }
  return PATH[PATH.length - 1][1];
}
const cursorOpacity = (t) =>
  Math.max(
    ramp(t, 0.9, 1.15) * (1 - ramp(t, 6.9, 7.3)),
    ramp(t, 7.95, 8.2) * (1 - ramp(t, 19.0, 19.4)),
    ramp(t, 22.45, 22.7),
  );

const SPINNER = (deg) =>
  `<svg width="16" height="16" viewBox="0 0 16 16" style="transform:rotate(${deg}deg)"><circle cx="8" cy="8" r="6.5" stroke="#eac54f" stroke-width="2" fill="none" opacity=".35"/><path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" stroke="#bf8700" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`;
const DOT = (color, alpha = 1) => `<span style="width:12px;height:12px;border-radius:50%;background:${color};opacity:${alpha};display:block"></span>`;
const HOLLOW = `<span style="width:14px;height:14px;border-radius:50%;border:2px solid #8c959f;display:block"></span>`;

const steps = [...document.querySelectorAll(".step")];
const stepTimes = { "pane-before": [7.9, 9.25, 9.95, 10.55], "pane-after": [7.9, 12.35, 14.05, 14.65, 15.15] };
for (const [paneId, times] of Object.entries(stepTimes)) {
  [...$(paneId).querySelectorAll(".step")].forEach((el, i) => (el.dataset.at = String(times[i])));
}

let last = {};
function setHTML(el, key, html) {
  if (last[key] !== html) {
    el.innerHTML = html;
    last[key] = html;
  }
}

window.__setTime = (t) => {
  // Scenes
  $("s1").style.opacity = String(ramp(t, 0, 0.35) * (1 - ramp(t, 7.2, 7.6)));
  $("s2").style.opacity = String(ramp(t, 7.45, 7.85) * (1 - ramp(t, 19.15, 19.55)));
  const s3 = ramp(t, 19.55, 19.95);
  $("s3").style.opacity = String(s3);
  $("s3-wrap").style.transform = `translate(-50%, ${(1 - easeOut(ramp(t, 19.55, 20.2))) * 10}px)`;

  // Scene 1: the Visual QA check
  const btn = $("run-btn");
  btn.classList.toggle("hover", t >= 2.2 && t < 2.6);
  btn.classList.toggle("down", t >= 2.6 && t < 2.72);
  btn.classList.toggle("primary", t < 2.72);
  btn.classList.toggle("disabled", t >= 2.72);
  setHTML(btn.querySelector("span"), "btn", t >= 2.72 ? "Running" : "Run Visual QA");
  let icon;
  let status;
  if (t < 2.75) {
    icon = HOLLOW;
    status = `<span style="color:var(--muted)">Waiting for a run</span>`;
  } else if (t < 3.15) {
    icon = DOT("#bf8700");
    status = `<span class="restore">Queued</span>`;
  } else if (t < 4.55) {
    icon = SPINNER(Math.round((t - 3.15) * 420) % 360);
    status = `<span class="restore">Restoring snapshot pr-visual-base<span class="bar"><span style="width:${Math.round(ramp(t, 3.15, 4.55) * 100)}%"></span></span></span>`;
  } else {
    icon = DOT("#00b37e", 0.6 + 0.4 * Math.cos((t - 4.55) * 5));
    status = `<span class="running"><i></i>Upstash Box Browser running (restored snapshot in ${m.box.snapshotRestoreSeconds}s)</span>`;
  }
  setHTML($("qa-icon"), "icon", icon);
  setHTML($("qa-status"), "status", status);
  setHTML(
    $("hook"),
    "hook",
    t < 2.85
      ? `<span>Webhook <span class="verb">POST /webhook</span> ready, no deliveries for this run yet</span>`
      : `<span class="verb">POST /webhook</span><span>pull_request.labeled (visual-qa)</span><span class="ok">202 Accepted</span><span>38 ms</span><span style="margin-left:auto">x-hub-signature-256 verified</span>`,
  );
  setHTML($("checks-sub"), "sub", t < 4.55 ? "1 successful and 1 waiting check" : "1 successful and 1 in progress check");

  // Scene 2: both previews
  fb.setOpen(t >= 9.15);
  fa.setOpen(t >= 12.25);
  fa.setValues(t >= 12.25 ? typed(t) : { card: "", exp: "", cvc: "", zip: "" });
  fa.setSubmitted(t >= 14.5);
  const overlay = ramp(t, 9.65, 9.95);
  fold.style.opacity = ghost.style.opacity = ghostLabel.style.opacity = String(overlay);
  for (const el of steps) el.style.opacity = String(ramp(t, Number(el.dataset.at), Number(el.dataset.at) + 0.22));
  $("b-verdict").style.opacity = String(ramp(t, 10.9, 11.2));
  $("a-verdict").style.opacity = String(ramp(t, 15.65, 15.95));
  if (t >= 12.25) {
    const pa = paneA.getBoundingClientRect();
    const r = fa.rect("#confirm");
    hit.style.cssText = `left:${r.left - pa.left - 4}px;top:${r.top - pa.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;opacity:${ramp(t, 15.15, 15.4)}`;
  } else hit.style.opacity = "0";
  $("tel-cpu").textContent = `${(m.box.cost.activeCpuSeconds * ramp(t, 7.8, 17.2)).toFixed(1)}s`;
  $("live-dot").style.opacity = String(0.55 + 0.45 * Math.cos((t - 7.5) * 4));

  // Scene 3
  costEl.classList.toggle("hl", t >= 23.7);

  // Cursor and click ripple
  const p = cursorAt(t);
  const click = CLICKS.find((c) => t >= c.t && t < c.t + 0.45);
  const press = CLICKS.some((c) => t >= c.t && t < c.t + 0.12);
  const cur = $("cursor");
  cur.style.opacity = String(cursorOpacity(t));
  cur.style.transform = `translate(${p.x - 6}px, ${p.y - 4}px) scale(${press ? 0.9 : 1})`;
  // The agent tag rides along while Claude Code moves, and steps aside when it parks over results.
  const tagOn = (a, b) => ramp(t, a, a + 0.15) * (1 - ramp(t, b, b + 0.15));
  $("cursor-tag").style.opacity = String(Math.max(tagOn(7.95, 9.9), tagOn(11.25, 15.5)));
  const rip = $("ripple");
  if (click) {
    const k = (t - click.t) / 0.45;
    const size = 12 + 46 * easeOut(k);
    const color = click.miss ? "207 34 46" : "9 105 218";
    rip.style.cssText = `left:${click.at.x - size / 2}px;top:${click.at.y - size / 2}px;width:${size}px;height:${size}px;opacity:${(1 - k) * 0.95};background:rgb(${color} / .2);border-color:rgb(${color} / .5)`;
  } else rip.style.opacity = "0";
};

// Audio cues for the renderer: clicks, keystrokes, and soft tones when a status lands.
window.__cues = [
  ...CLICKS.map((c) => ({ t: c.t, kind: "click" })),
  ...TYPING.flatMap((f) => [...f.text].map((_, i) => ({ t: f.start + i / CPS, kind: "key" }))),
  { t: 4.55, kind: "up" },
  { t: 10.9, kind: "down" },
  { t: 15.65, kind: "up" },
  { t: 19.6, kind: "post" },
];
window.__setTime(0);
document.body.dataset.ready = "1";
