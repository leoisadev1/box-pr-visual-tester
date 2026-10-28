// Builds the PR header and the bot's review comment from artifacts/run-metrics.json.
// Used by render/pr-comment.html (still) and video/index.html (scene 3).

export const ICONS = {
  box: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><path d="M12 2.8 20.5 7.4v9.2L12 21.2 3.5 16.6V7.4z"/><path d="M3.8 7.6 12 12l8.2-4.4M12 12v9"/></svg>`,
  claude: `<svg viewBox="0 0 24 24" fill="#fff"><path d="M12 2.5c.5 0 .8.3.9.8l.9 5.6 4.5-3.5c.4-.3.9-.3 1.2.1.3.4.3.9-.1 1.2l-4.2 3.8 5.6.9c.5.1.8.4.8.9s-.3.8-.8.9l-5.6.6 4 4c.4.4.4.9 0 1.2-.3.4-.8.4-1.2.1l-4.5-3.4-.7 5.6c-.1.5-.4.8-.9.8s-.8-.3-.9-.8l-.8-5.6-4.5 3.4c-.4.3-.9.3-1.2-.1-.3-.3-.3-.8.1-1.2l4-4-5.6-.6c-.5-.1-.8-.4-.8-.9s.3-.8.8-.9l5.6-.9L5 6.7c-.4-.3-.4-.8-.1-1.2.3-.4.8-.4 1.2-.1l4.5 3.5.9-5.6c.1-.5.4-.8.9-.8z"/></svg>`,
  pr: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354Z"/></svg>`,
};

const px = (n) => `${Math.round(n * 10) / 10}px`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function submitCell(r) {
  if (r.submit.kind === "unreachable") return "Button unreachable";
  return r.submit.validationMessage ? `Shows "${esc(r.submit.validationMessage)}"` : "No validation message";
}

export function prHeadHTML({ avatar }) {
  return `
  <div class="pr-head">
    <h1 class="title">Fix mobile overflow on billing checkout modal <span class="num">#42</span></h1>
    <div class="meta">
      <span class="pill open">${ICONS.pr.replace("<svg", '<svg width="14" height="14"')} Open</span>
      <img class="avatar" src="${avatar}" width="22" height="22" alt="">
      <span><b>leodev</b> wants to merge 1 commit into <span class="branch">main</span> from <span class="branch">leodev/fix-billing-modal</span></span>
    </div>
  </div>`;
}

export function commentHTML({ m, shots, shotWidth = 260 }) {
  const bm = m.measured.before.reports.mobile;
  const am = m.measured.after.reports.mobile;
  const status = (r) => (r.status === "pass" ? "PASS" : "FAIL");
  const pill = (r) => `<span class="pill ${r.status}">${status(r)}</span>`;
  const cost = m.box.cost;
  return `
  <div class="comment" style="--shot-w:${shotWidth}px">
    <div class="who"><div class="bot-avatar" style="width:40px;height:40px">${ICONS.box}</div></div>
    <div class="comment-box">
      <div class="comment-head"><b>upstash-box-qa</b><span class="pill bot">bot</span><span>commented just now</span></div>
      <div class="comment-body">
        <h3>Visual Review: ${m.verdict.status.toUpperCase()}</h3>
        <p><b>${status(bm)} on <code>main</code>, ${status(am)} on <code>PR #42</code>.</b> Checked in Upstash Box <code>${esc(m.box.boxId)}</code> at 390x844 and 1440x900.</p>
        <div class="review">
          <div class="shots">
            <figure class="shot" data-shot="before"><figcaption><span>Before: <code>main</code></span>${pill(bm)}</figcaption><img src="${shots.before}" alt="main, mobile"></figure>
            <figure class="shot" data-shot="after"><figcaption><span>After: <code>PR #42</code></span>${pill(am)}</figcaption><img src="${shots.after}" alt="PR 42, mobile"></figure>
          </div>
          <div class="side">
            <div class="verdict" data-part="verdict">
              <div class="by"><span class="claude-mark">${ICONS.claude}</span>Claude Code verdict<span style="font-weight:500;text-transform:none;letter-spacing:0">claude-sonnet-4-5</span></div>
              <div class="headline">${esc(m.verdict.headline)}</div>
              <div class="summary">${esc(m.verdict.summary)}</div>
            </div>
            <table class="metrics" data-part="metrics">
              <tr><th>Mobile 390x844</th><th><code>main</code></th><th><code>PR #42</code></th></tr>
              <tr><td>"${esc(bm.cta.label)}" bottom edge</td><td>${px(bm.cta.rect.bottom)}</td><td>${px(am.cta.rect.bottom)}</td></tr>
              <tr><td>Below the fold</td><td class="bad">${px(bm.cta.overflowBelowFoldPx)}</td><td class="good">${px(am.cta.overflowBelowFoldPx)}</td></tr>
              <tr><td>Button visible</td><td class="bad">${bm.cta.visiblePercent}%</td><td class="good">${am.cta.visiblePercent}%</td></tr>
              <tr><td>Submit with empty name</td><td class="bad">${submitCell(bm)}</td><td class="good">${submitCell(am)}</td></tr>
              <tr><td>Console errors</td><td>${bm.consoleErrors.length}</td><td>${am.consoleErrors.length}</td></tr>
              <tr><td>Desktop 1440x900</td><td>${status(m.measured.before.reports.desktop)}</td><td>${status(m.measured.after.reports.desktop)}</td></tr>
            </table>
            <div class="cost" data-part="cost"><span class="dot"></span>Total run cost: $${cost.totalUsd.toFixed(4)} | ${cost.activeCpuSeconds.toFixed(1)}s active CPU @ $${cost.cpuHourUsd.toFixed(2)}/CPU-hr</div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}
