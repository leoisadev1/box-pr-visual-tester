// Deterministic timeline for the demo. window.__setTime(t) paints the frame for t seconds and
// resolves once the embedded recording has seeked. The renderer steps t at 60 fps.
// Story: the PR is open and its Visual QA check starts, the Actions job runs in Upstash Box,
// then the review comment appears with the recording playing and the before/after screenshots.
const $ = (id) => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ramp = (t, a, b) => clamp((t - a) / (b - a));
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const easeOut = (p) => 1 - Math.pow(1 - p, 3);
const r1 = (n) => Math.round(n * 10) / 10;

const run = await (await fetch("../artifacts/pr-1/inspection.json")).json();
// Box-side values are examples (no Box key on the machine that made this); see the README.
const EXAMPLE = { boxId: "box_01J9X7K2M8P4Q", snapshotId: "snap_01J9X6R8V2K4M", restore: "1.4s", cost: "Total run cost: $0.0038 | 5.4s active CPU @ $0.10/CPU-hr" };
const bm = run.before.reports.mobile;
const am = run.after.reports.mobile;
const bd = run.before.reports.desktop;
const ad = run.after.reports.desktop;

// Octicons (MIT, Primer)
const OCT = {
  pr: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354Z"/></svg>`,
  repo: `<svg width="16" height="16" viewBox="0 0 16 16" fill="#59636e"><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z"/></svg>`,
  play: (size, color = "#fff") => `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="${color}"><path d="M5 3.8v8.4a.6.6 0 0 0 .92.5l6.6-4.2a.6.6 0 0 0 0-1L5.92 3.3A.6.6 0 0 0 5 3.8Z"/></svg>`,
};
const OK = `<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="#1f883d"/><path d="m4.6 8.2 2.2 2.2 4.6-4.6" stroke="#fff" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SKIP = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#59636e" stroke-width="1.4"><circle cx="8" cy="8" r="6.6"/><path d="m3.6 12.4 8.8-8.8"/></svg>`;
const PENDING = `<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.4" fill="none" stroke="#9a6700" stroke-width="1.6"/><circle cx="8" cy="8" r="2" fill="#9a6700"/></svg>`;
const SPIN = (deg) => `<svg width="16" height="16" viewBox="0 0 16 16" style="transform:rotate(${deg}deg)"><circle cx="8" cy="8" r="6.4" fill="none" stroke="#eac54f" stroke-width="1.8" opacity=".45"/><path d="M8 1.6a6.4 6.4 0 0 1 6.4 6.4" fill="none" stroke="#bf8700" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const big = (bg, inner) => `<span style="width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:${bg}">${inner}</span>`;
const CHECK_BIG = `<svg width="18" height="18" viewBox="0 0 16 16"><path d="m3.5 8.4 3 3 6-6.2" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const DOT_BIG = `<span style="width:12px;height:12px;border-radius:50%;background:#bf8700;display:block"></span>`;

// Shared chrome
for (const el of document.querySelectorAll("[data-repohead]")) {
  const tab = el.dataset.tab ?? "Pull requests";
  el.innerHTML = `<div class="crumb">${OCT.repo}<span>leoisadev1</span><span class="sep">/</span><b>box-pr-visual-tester</b><span class="pub">Public</span></div>
    <div class="reponav">${["Code", "Issues", "Pull requests", "Actions", "Projects", "Insights"]
      .map((n) => `<span class="${n === tab ? "on" : ""}">${n}${n === "Pull requests" ? ' <span class="count">1</span>' : ""}</span>`).join("")}</div>`;
}
for (const el of document.querySelectorAll("[data-prtitle]")) {
  el.innerHTML = `<div class="prtitle"><h1>Fix mobile overflow on billing checkout modal <span class="num">#1</span></h1>
    <div class="prmeta"><span class="state">${OCT.pr} Open</span><b>leoisadev1</b> wants to merge 1 commit into <span class="branch">main</span> from <span class="branch">fix/billing-modal-mobile</span></div>
    <div class="tabs"><span class="on">Conversation <span class="count">2</span></span><span>Commits <span class="count">1</span></span><span>Checks <span class="count">2</span></span><span>Files changed <span class="count">1</span></span></div></div>`;
}
for (const el of document.querySelectorAll("[data-sidebar]")) {
  el.innerHTML = `<div class="sb">
    <div class="grp"><div class="h">Reviewers</div>No reviews</div>
    <div class="grp"><div class="h">Assignees</div>No one assigned</div>
    <div class="grp"><div class="h">Labels</div><span class="chip">visual-qa</span></div>
    <div class="grp"><div class="h">Development</div>Successfully merging this pull request may close these issues.</div>
  </div>`;
}
for (const el of document.querySelectorAll("[data-gh]")) el.innerHTML = OCT.play(13);
for (const el of document.querySelectorAll("[data-actions-av]")) el.innerHTML = OCT.play(22);
for (const el of document.querySelectorAll("[data-icon=ok]")) el.innerHTML = OK;
$("c-box").textContent = EXAMPLE.boxId;
$("d-cost").textContent = EXAMPLE.cost;
const submitCell = (r) => (r.submit.kind === "unreachable" ? "Button unreachable" : `Shows "${r.submit.validationMessage}"`);
const status = (r) => (r.status === "pass" ? "PASS" : "FAIL");
$("d-metrics").innerHTML = [
  ["Check", "<code>main</code>", "<code>PR #1</code>"],
  [`"${bm.cta.label}" bottom edge`, `${r1(bm.cta.rect.bottom)}px`, `${r1(am.cta.rect.bottom)}px`],
  ["Below the fold", `${r1(bm.cta.overflowBelowFoldPx)}px`, `${r1(am.cta.overflowBelowFoldPx)}px`],
  ["Button visible", `${bm.cta.visiblePercent}%`, `${am.cta.visiblePercent}%`],
  ["Submit with empty name", submitCell(bm), submitCell(am)],
  ["Console errors", bm.consoleErrors.length, am.consoleErrors.length],
  ["Desktop 1440x900", status(bd), status(ad)],
].map((row, i) => `<tr>${row.map((c) => (i === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join("")}</tr>`).join("");

// Actions job: real step names from .github/workflows/visual-qa.yml. Probe lines are the real
// output from PR #1; the restore, recording and publish lines show what box mode prints.
const probe = (label, r) =>
  `${label.padEnd(6)} ${r.viewport.name.padEnd(7)} ${r.viewport.width}x${r.viewport.height} ${r.status === "pass" ? '<span class="ok">PASS</span>' : '<span class="bad">FAIL</span>'} bottom=${r1(r.cta.rect.bottom)}px below_fold=${r1(r.cta.overflowBelowFoldPx)}px visible=${r.cta.visiblePercent}%`;
const STEPS = [
  { name: "Set up job", t: [7.0, 7.2], dur: "1s" },
  { name: "Check out the tester", t: [7.2, 7.4], dur: "1s" },
  { name: "Set up Node.js", t: [7.4, 7.6], dur: "2s" },
  { name: "Install dependencies", t: [7.6, 7.8], dur: "6s" },
  { name: "Pick mode and resolve pinned SHAs", t: [7.8, 8.4], dur: "1s", log: [`base main @ ${run.pr.baseSha.slice(0, 7)} | head fix/billing-modal-mobile @ ${run.pr.headSha.slice(0, 7)}`, "mode: box (Upstash Box + Box Browser)"] },
  { name: "Restore Box from snapshot", t: [8.4, 9.4], dur: "2s", log: [`restored ${EXAMPLE.boxId} from ${EXAMPLE.snapshotId} in ${EXAMPLE.restore}`] },
  { name: "Install Chromium (local mode)", skip: 9.4 },
  { name: "Start base (:3000) & PR (:3001) previews", t: [9.4, 10.6], dur: "9s", log: [`main ${run.pr.baseSha.slice(0, 7)} (main) -> localhost:3000`, `pr   ${run.pr.headSha.slice(0, 7)} (fix/billing-modal-mobile) -> localhost:3001`, "both previews answer on /billing/"] },
  { name: "Inspect mobile (390x844) & desktop (1440x900)", t: [10.6, 13.8], dur: "18s", log: [probe("main", bm), probe("main", bd), probe("PR #1", am), probe("PR #1", ad), "downloaded Box Browser recording -> recording.mp4, recording.gif"] },
  { name: "Upload screenshots as a workflow artifact", t: [13.8, 14.1], dur: "1s" },
  { name: "Publish the visual review (PR comment in box mode, job summary in local mode)", t: [14.1, 14.9], dur: "2s", log: ["uploaded 4 screenshots and the recording to Upstash Blob", "posted the visual review on leoisadev1/box-pr-visual-tester#1"] },
  { name: "Clean up box and previews", t: [14.9, 15.2], dur: "1s", log: [`deleted ${EXAMPLE.boxId}`] },
];
const LOG_STEPS = new Set(["Restore Box from snapshot", "Start base (:3000) & PR (:3001) previews", "Inspect mobile (390x844) & desktop (1440x900)", "Publish the visual review (PR comment in box mode, job summary in local mode)"]);

// Cursor path
const det = () => { const r = $("a-det").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 + 2 }; };
$("sA").style.opacity = "1";
const DET = det();
$("sA").style.opacity = "0";
const PATH = [[1.0, { x: 1500, y: 980 }], [4.4, { x: 1500, y: 980 }], [5.5, DET], [6.4, DET]];
const CLICK = { t: 5.75, at: DET };
function cursorAt(t) {
  if (t <= PATH[0][0]) return PATH[0][1];
  for (let i = 1; i < PATH.length; i++) {
    const [t1, p1] = PATH[i];
    const [t0, p0] = PATH[i - 1];
    if (t <= t1) { const p = easeInOut(ramp(t, t0, t1)); return { x: p0.x + (p1.x - p0.x) * p, y: p0.y + (p1.y - p0.y) * p }; }
  }
  return PATH.at(-1)[1];
}

const rec = $("rec");
// The local server has no Range support, which makes a streamed video unseekable. A blob URL is.
rec.src = URL.createObjectURL(await (await fetch("recording.webm")).blob());
await new Promise((done) => (rec.readyState >= 2 ? done() : rec.addEventListener("loadeddata", done, { once: true })));
await document.fonts.ready;
await Promise.all([...document.images].map((i) => i.decode().catch(() => null)));
const REC_START = 17.2;

const cache = {};
const set = (el, key, html) => { if (cache[key] !== html) { el.innerHTML = html; cache[key] = html; } };

// Seek, then give the compositor a frame so the screenshot shows the new video frame.
// requestVideoFrameCallback does not always fire in headless Chromium, so it races two rAFs.
async function seek(time) {
  if (Math.abs(rec.currentTime - time) < 1e-4) return;
  await new Promise((done) => { rec.addEventListener("seeked", done, { once: true }); rec.currentTime = time; });
  await Promise.race([
    new Promise((done) => rec.requestVideoFrameCallback(() => done())),
    new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  ]);
}

window.__setTime = async (t) => {
  const fadeA = ramp(t, 0, 0.3) * (1 - ramp(t, 6.55, 6.85));
  const fadeB = ramp(t, 6.75, 7.05) * (1 - ramp(t, 15.95, 16.25));
  const fadeC = ramp(t, 16.15, 16.45) * (1 - ramp(t, 24.85, 25.1));
  const fadeD = ramp(t, 25.0, 25.3);
  $("sA").style.opacity = String(fadeA);
  $("sB").style.opacity = String(fadeB);
  $("sC").style.opacity = String(fadeC);
  $("sD").style.opacity = String(fadeD);

  // A: check queued, then running
  const running = t >= 1.6;
  set($("a-qa-ic"), "aic", running ? SPIN(Math.round((t - 1.6) * 400) % 360) : PENDING);
  set($("a-qa-st"), "ast", running ? "In progress" : "Queued");
  set($("a-big"), "abig", big("#fff8c5", DOT_BIG));
  set($("a-title"), "at", "Some checks haven't completed yet");
  set($("a-sub"), "asub", running ? "1 successful and 1 in progress check" : "1 successful and 1 queued check");
  $("a-det").classList.toggle("hover", t >= 5.45 && t < 6.6);

  // B: steps complete in order; the active step with output shows its log
  const done = t >= 15.2;
  const spinB = SPIN(Math.round(t * 400) % 360);
  set($("b-run-ic"), "brun", done ? OK.replace('width="16" height="16"', 'width="26" height="26"') : spinB.replace('width="16" height="16"', 'width="26" height="26"'));
  set($("b-job-ic"), "bjob", done ? OK : spinB);
  set($("b-job-sub"), "bsub", done ? "succeeded now in 49s" : "in progress");
  const html = STEPS.map((s) => {
    if (s.skip !== undefined) return `<div class="step"><span class="ic">${t >= s.skip ? SKIP : ""}</span>${s.name}</div>`;
    const [a, b] = s.t;
    const state = t < a ? "wait" : t < b ? "run" : "done";
    const icon = state === "done" ? OK : state === "run" ? spinB : "";
    let row = `<div class="step ${state === "run" ? "run" : ""}" style="opacity:${state === "wait" ? 0.55 : 1}"><span class="ic">${icon}</span>${s.name}<span class="t">${state === "done" ? s.dur : ""}</span></div>`;
    const showLog = s.log && LOG_STEPS.has(s.name) && t >= a && (state === "run" || (t < b + 0.9 && !STEPS.some((o) => o.t && LOG_STEPS.has(o.name) && o.t[0] > a && t >= o.t[0])));
    if (showLog) {
      const n = Math.min(s.log.length, Math.floor(((t - a) / Math.max(0.2, b - a - 0.15)) * s.log.length) + 1);
      row += `<div class="log">${s.log.slice(0, n).map((l, i) => `<span class="n">${i + 1}</span>${l}`).join("\n")}</div>`;
    }
    return row;
  }).join("");
  set($("b-steps"), "steps", html);

  // C: comment slides in, recording plays at 1x from REC_START, then holds its last frame
  $("c-cmt").style.transform = `translateY(${(1 - easeOut(ramp(t, 16.3, 16.9))) * 14}px)`;
  $("c-cmt").style.opacity = String(ramp(t, 16.3, 16.75));
  await seek(clamp(t - REC_START, 0, rec.duration - 0.02));

  // Cursor
  const p = cursorAt(t);
  const press = t >= CLICK.t && t < CLICK.t + 0.12;
  const cur = $("cursor");
  cur.style.opacity = String(ramp(t, 1.0, 1.25) * (1 - ramp(t, 6.5, 6.75)));
  cur.style.transform = `translate(${p.x - 6}px, ${p.y - 4}px) scale(${press ? 0.9 : 1})`;
  const rip = $("ripple");
  if (t >= CLICK.t && t < CLICK.t + 0.45) {
    const k = (t - CLICK.t) / 0.45;
    const size = 12 + 44 * easeOut(k);
    rip.style.cssText = `left:${CLICK.at.x - size / 2}px;top:${CLICK.at.y - size / 2}px;width:${size}px;height:${size}px;opacity:${(1 - k) * 0.9}`;
  } else rip.style.opacity = "0";
};

window.__cues = [
  { t: CLICK.t, kind: "click" },
  { t: 15.2, kind: "up" },
  { t: 16.35, kind: "post" },
];
await window.__setTime(0);
document.body.dataset.ready = "1";
