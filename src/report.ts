import { z } from "zod";
import type { CheckoutReport, ViewportName } from "./probe.js";

/** What the Claude Code agent in the box must return. Validated by `box.agent.run({ responseSchema })`. */
export const VerdictSchema = z.object({
  status: z.enum(["pass", "fail"]),
  headline: z.string().describe("One sentence, under 90 characters."),
  summary: z.string().describe("Two or three sentences a reviewer can act on."),
  regressions: z.array(z.string()).describe("Problems the PR introduces. Empty when there are none."),
});
export type Verdict = z.infer<typeof VerdictSchema>;

export interface BranchRun {
  label: string;
  reports: Record<ViewportName, CheckoutReport>;
}

export interface ScreenshotUrls {
  kind: "urls";
  beforeMobile: string;
  afterMobile: string;
  beforeDesktop: string;
  afterDesktop: string;
  /** Side-by-side recording of the mobile flow. The GIF plays inline; the MP4 is linked. */
  recording: { gif: string; mp4: string } | null;
}

/** Inline images when they have public URLs, otherwise a link to where the PNGs were attached. */
export type Screenshots = ScreenshotUrls | { kind: "attached"; label: string; url: string };

export interface CostLine {
  totalUsd: number;
  activeCpuSeconds: number;
  cpuHourUsd: number;
}

export const COMMENT_MARKER = "<!-- upstash-box-visual-review -->";

/** Prompt for the in-box agent: structured metrics in, one verdict out. */
export function buildVerdictPrompt({
  prNumber,
  title,
  before,
  after,
  agentRead,
}: {
  prNumber: number;
  title: string;
  before: BranchRun;
  after: BranchRun;
  agentRead: unknown;
}): string {
  return [
    `You are reviewing pull request #${prNumber}, "${title}", for visual regressions.`,
    "A Playwright probe opened the billing checkout modal on the base branch and on the PR, measured",
    "the primary button with getBoundingClientRect, and submitted the form with an empty cardholder name.",
    "",
    "Base branch metrics:",
    JSON.stringify(before.reports, null, 2),
    "",
    "PR metrics:",
    JSON.stringify(after.reports, null, 2),
    "",
    "What the browser model read from the PR's final page state:",
    JSON.stringify(agentRead, null, 2),
    "",
    "Decide whether the PR fixes the base branch problem without adding new ones.",
    "Quote pixel numbers from the metrics. Do not invent measurements.",
  ].join("\n");
}

/** One sentence about one branch, built only from what the probe measured. */
function describeBranch(label: string, r: CheckoutReport): string {
  const cta = `"${r.cta.label}"`;
  const where =
    r.cta.overflowBelowFoldPx > 0
      ? `${cta} ends ${r.cta.overflowBelowFoldPx}px below the fold (${r.cta.visiblePercent}% visible)`
      : `${cta} is ${r.cta.visiblePercent}% visible`;
  let submit: string;
  switch (r.submit.kind) {
    case "unreachable":
      submit = "and cannot be clicked";
      break;
    case "clicked":
      submit = r.submit.validationMessage
        ? `and submitting with an empty name shows "${r.submit.validationMessage}"`
        : "but submitting with an empty name shows no validation message";
      break;
    default: {
      const _exhaustive: never = r.submit;
      return _exhaustive;
    }
  }
  return `On ${label}, ${where} ${submit}, with ${r.consoleErrors.length} console errors.`;
}

const VIEWPORT_NAMES = ["mobile", "desktop"] as const;
const dims = (r: CheckoutReport) => `${r.viewport.width}x${r.viewport.height}`;

/** Deterministic verdict from the metrics alone. Used for local runs and when the agent call fails. */
export function ruleBasedVerdict({ before, after }: { before: BranchRun; after: BranchRun }): Verdict {
  const failing = VIEWPORT_NAMES.filter((v) => after.reports[v].status === "fail");
  const fixed = VIEWPORT_NAMES.filter((v) => before.reports[v].status === "fail" && after.reports[v].status === "pass");
  const regressions = failing
    .filter((v) => before.reports[v].status === "pass")
    .map((v) => `${dims(after.reports[v])}: "${after.reports[v].cta.label}" fails on ${after.label} but passes on ${before.label}`);
  const status = failing.length === 0 ? "pass" : "fail";
  let headline: string;
  if (status === "fail") {
    headline = `The checkout button fails on ${failing.map((v) => dims(after.reports[v])).join(" and ")}`;
  } else if (fixed.length > 0) {
    headline = `Fixes the checkout button on ${fixed.map((v) => dims(after.reports[v])).join(" and ")}`;
  } else {
    headline = "Checkout passes on every viewport, before and after";
  }
  return {
    status,
    headline,
    summary: `${describeBranch(before.label, before.reports.mobile)} ${describeBranch(after.label, after.reports.mobile)}`,
    regressions,
  };
}

function px(n: number): string {
  return `${Math.round(n * 10) / 10}px`;
}

function submitCell(r: CheckoutReport): string {
  switch (r.submit.kind) {
    case "clicked":
      return r.submit.validationMessage ? `Shows "${r.submit.validationMessage}"` : "No validation message";
    case "unreachable":
      return "Button unreachable";
    default: {
      const _exhaustive: never = r.submit;
      return _exhaustive;
    }
  }
}

export function formatCost(cost: CostLine): string {
  return `Total run cost: $${cost.totalUsd.toFixed(4)} | ${cost.activeCpuSeconds.toFixed(1)}s active CPU @ $${cost.cpuHourUsd.toFixed(2)}/CPU-hr`;
}

/** Markdown body for the PR comment. The marker lets a re-run edit the same comment. */
export function renderComment({
  prNumber,
  checkedIn,
  before,
  after,
  verdict,
  verdictBy,
  shots,
  cost,
  preface = [],
}: {
  prNumber: number;
  /** Markdown naming where the check ran, such as "Upstash Box `box_...`". */
  checkedIn: string;
  before: BranchRun;
  after: BranchRun;
  verdict: Verdict;
  verdictBy: string;
  shots: Screenshots;
  /** Box spend for the run, or null when it ran outside a box. */
  cost: CostLine | null;
  /** Lines placed above everything else, for example a note saying who posted the comment. */
  preface?: string[];
}): string {
  const bm = before.reports.mobile;
  const am = after.reports.mobile;
  const status = (r: CheckoutReport) => (r.status === "pass" ? "PASS" : "FAIL");
  let mobileShots: string[];
  let desktopShots: string[];
  switch (shots.kind) {
    case "urls":
      mobileShots = [
        ...(shots.recording
          ? [
              "### Recording, mobile 390x844",
              "",
              `Left: \`${before.label}\`. Right: \`${after.label}\`. [Download the MP4](${shots.recording.mp4})`,
              "",
              `<img src="${shots.recording.gif}" width="760" alt="Recording of the checkout flow on ${before.label} and ${after.label}">`,
              "",
            ]
          : []),
        "### Before and after, mobile 390x844",
        "",
        `| Before: \`${before.label}\` | After: \`${after.label}\` |`,
        "| --- | --- |",
        `| <img src="${shots.beforeMobile}" width="300" alt="Before, mobile"> | <img src="${shots.afterMobile}" width="300" alt="After, mobile"> |`,
      ];
      desktopShots = [
        "### Before and after, desktop 1440x900",
        "",
        `| Before: \`${before.label}\` | After: \`${after.label}\` |`,
        "| --- | --- |",
        `| <img src="${shots.beforeDesktop}" width="420" alt="Before, desktop"> | <img src="${shots.afterDesktop}" width="420" alt="After, desktop"> |`,
      ];
      break;
    case "attached":
      mobileShots = [`Screenshots: [${shots.label}](${shots.url})`];
      desktopShots = [];
      break;
    default: {
      const _exhaustive: never = shots;
      return _exhaustive;
    }
  }
  return [
    ...preface,
    ...(preface.length > 0 ? [""] : []),
    COMMENT_MARKER,
    `## Visual Review: ${verdict.status.toUpperCase()}`,
    "",
    `PR #${prNumber}. **${status(bm)} on \`${before.label}\`, ${status(am)} on \`${after.label}\`.** Checked in ${checkedIn} at 390x844 and 1440x900.`,
    "",
    ...mobileShots,
    "",
    ...(desktopShots.length > 0 ? [...desktopShots, ""] : []),
    `### ${verdictBy} verdict`,
    "",
    `**${verdict.headline}**`,
    "",
    verdict.summary,
    "",
    "### DOM metrics, mobile 390x844",
    "",
    `| Check | \`${before.label}\` | \`${after.label}\` |`,
    "| --- | --- | --- |",
    `| "${bm.cta.label}" bottom edge | ${px(bm.cta.rect.bottom)} | ${px(am.cta.rect.bottom)} |`,
    `| Below the fold | ${px(bm.cta.overflowBelowFoldPx)} | ${px(am.cta.overflowBelowFoldPx)} |`,
    `| Button visible | ${bm.cta.visiblePercent}% | ${am.cta.visiblePercent}% |`,
    `| Submit with empty name | ${submitCell(bm)} | ${submitCell(am)} |`,
    `| Console errors | ${bm.consoleErrors.length} | ${am.consoleErrors.length} |`,
    `| Desktop 1440x900 | ${status(before.reports.desktop)} | ${status(after.reports.desktop)} |`,
    "",
    ...(cost
      ? [
          `\`${formatCost(cost)}\``,
          "",
          "<sub>Agent cost from `Run.cost`, plus in-box command time at the CPU rate above. Browser-model tokens for `tab.act` and `tab.extract` are billed separately.</sub>",
          "",
        ]
      : []),
  ].join("\n");
}
