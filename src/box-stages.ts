// The stages of one visual QA run. `pr-visual-tester.ts` runs them in one process; `ci.ts` runs
// each as its own GitHub Actions step against the same box.
import { Agent, Box, BoxApiKey, ClaudeCode, type Run, type Tab } from "@upstash/box";
import { Bucket } from "@upstash/blob";
import { chromium, type Browser, type CDPSession, type Page } from "playwright-core";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Env } from "./env.js";
import type { PullRequestRef } from "./github.js";
import { annotate, inspectCheckout, VIEWPORTS, type Viewport, type ViewportName } from "./probe.js";
import {
  buildVerdictPrompt,
  ruleBasedVerdict,
  VerdictSchema,
  type BranchRun,
  type CostLine,
  type ScreenshotUrls,
  type Verdict,
} from "./report.js";

export type Log = (message: string) => void;

export const BRANCHES = [
  { key: "before", folder: "main", port: 3000 },
  { key: "after", folder: "pr", port: 3001 },
] as const;
export type BranchKey = (typeof BRANCHES)[number]["key"];

/** What the browser model reads back from the final page, as a cross-check on the DOM probe. */
export const AgentRead = z.object({
  primaryButtonLabel: z.string(),
  validationMessage: z.string().nullable(),
});
export type AgentRead = z.infer<typeof AgentRead>;

export function agentConfig(env: Env) {
  return {
    harness: Agent.ClaudeCode,
    model: ClaudeCode.Sonnet_4_5,
    apiKey: env.ANTHROPIC_API_KEY ?? BoxApiKey.UpstashKey,
  };
}

/** Time spent in box commands and agent runs, which is what `Run.cost` reports. */
export interface Spend {
  agentUsd: number;
  computeMs: number;
}
export const NO_SPEND: Spend = { agentUsd: 0, computeMs: 0 };

export function addRuns(spend: Spend, runs: Run<unknown>[]): Spend {
  return runs.reduce(
    (acc, run) => ({ agentUsd: acc.agentUsd + run.cost.totalUsd, computeMs: acc.computeMs + run.cost.computeMs }),
    spend,
  );
}

/**
 * `Run.cost.totalUsd` is set for agent runs only; command runs report wall-clock `computeMs`.
 * So the line is agent cost plus in-box command time at the CPU rate. Browser-model tokens for
 * `tab.act` and `tab.extract` are billed separately.
 */
export function costLine({ spend, env }: { spend: Spend; env: Env }): CostLine {
  const activeCpuSeconds = spend.computeMs / 1000;
  return {
    totalUsd: spend.agentUsd + (activeCpuSeconds / 3600) * env.BOX_CPU_HOUR_USD,
    activeCpuSeconds,
    cpuHourUsd: env.BOX_CPU_HOUR_USD,
  };
}

async function mustSucceed<T>(pending: Promise<Run<T>>): Promise<Run<T>> {
  const run = await pending;
  if (run.exitCode !== 0) throw new Error(`Box command failed (${run.exitCode}): ${run.stderr ?? ""}`);
  return run;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/**
 * One-time setup: a box with Chromium, the repo cloned and its npm cache warm. Every PR run
 * restores this snapshot instead of installing from scratch.
 */
export async function createBaseSnapshot({ env, repoUrl, log }: { env: Env; repoUrl: string; log: Log }): Promise<string> {
  let t = performance.now();
  const seed = await Box.create({
    runtime: "node",
    size: "small",
    browser: true,
    agent: agentConfig(env),
    git: { token: env.GITHUB_TOKEN },
  });
  log(`created ${seed.id} (node, small, browser: true) in ${seconds(performance.now() - t)}`);
  try {
    t = performance.now();
    await seed.git.clone({ repo: repoUrl, folder: "seed", depth: 1 });
    await seed.cd("seed");
    log(`cloned ${repoUrl} in ${seconds(performance.now() - t)}`);
    t = performance.now();
    await mustSucceed(seed.exec.command("npm ci --no-audit --no-fund"));
    log(`npm ci warmed the npm cache in ${seconds(performance.now() - t)}`);
    t = performance.now();
    const snapshot = await seed.snapshot({ name: "pr-visual-base" });
    log(`snapshot ${snapshot.id} ready (${(snapshot.size_bytes / 1e6).toFixed(0)} MB) in ${seconds(performance.now() - t)}`);
    return snapshot.id;
  } finally {
    await seed.delete();
    log(`deleted seed box ${seed.id}`);
  }
}

export async function restoreBox({
  env,
  snapshotId,
  keepAlive,
  log,
}: {
  env: Env;
  snapshotId: string;
  keepAlive: boolean;
  log: Log;
}): Promise<{ box: Box; restoreSeconds: number }> {
  const start = performance.now();
  const box = await Box.fromSnapshot(snapshotId, {
    size: "small",
    browser: true,
    keepAlive,
    agent: agentConfig(env),
    git: { token: env.GITHUB_TOKEN },
  });
  const restoreSeconds = (performance.now() - start) / 1000;
  log(`restored ${box.id} from ${snapshotId} in ${restoreSeconds.toFixed(1)}s`);
  return { box, restoreSeconds };
}

/** Checks out base and head at the event's SHAs and serves them on :3000 and :3001. */
export async function startPreviews({
  box,
  pr,
  env,
  log,
}: {
  box: Box;
  pr: PullRequestRef;
  env: Env;
  log: Log;
}): Promise<Run<string>[]> {
  const runs: Run<string>[] = [];
  for (const branch of BRANCHES) {
    const isHead = branch.key === "after";
    const sha = isHead ? pr.headSha : pr.baseSha;
    await box.git.clone({
      repo: isHead ? pr.headCloneUrl : pr.baseCloneUrl,
      branch: isHead ? pr.headRef : pr.baseRef,
      folder: branch.folder,
      depth: 1,
    });
    await box.cd(branch.folder);
    // The branch may have moved since the event fired. Pin the commit the event was about.
    runs.push(
      await mustSucceed(
        box.exec.command(
          `git fetch --depth 1 origin ${sha} && git checkout --detach ${sha} && test "$(git rev-parse HEAD)" = ${sha}`,
        ),
      ),
    );
    runs.push(await mustSucceed(box.exec.command("npm ci --prefer-offline --no-audit --no-fund")));
    runs.push(
      await mustSucceed(
        box.exec.command(`PORT=${branch.port} nohup ${env.PREVIEW_START} > /tmp/${branch.folder}.log 2>&1 &`),
      ),
    );
    await box.cd("..");
    log(`${branch.folder.padEnd(4)} ${sha.slice(0, 7)} (${isHead ? pr.headRef : pr.baseRef}) -> localhost:${branch.port}`);
  }
  runs.push(
    await mustSucceed(
      box.exec.command(
        `for i in $(seq 1 120); do curl -sf localhost:3000${env.PREVIEW_PATH} >/dev/null && curl -sf localhost:3001${env.PREVIEW_PATH} >/dev/null && exit 0; sleep 0.25; done; exit 1`,
      ),
    ),
  );
  log(`both previews answer on ${env.PREVIEW_PATH}`);
  return runs;
}

export interface BranchInspection {
  run: BranchRun;
  shots: Record<ViewportName, Uint8Array>;
  agentRead: AgentRead | null;
  browserTokens: number;
}

function findPage(browser: Browser, url: string): Page {
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((p) => p.url().startsWith(url));
  if (!page) throw new Error(`No CDP page found for ${url}`);
  return page;
}

/**
 * Retina mobile or desktop metrics through CDP, so `tab.screenshot()` captures the same viewport.
 * Chromium drops the override when the session detaches, so the caller keeps it open until the
 * screenshot is taken.
 */
async function emulate(page: Page, viewport: Viewport): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 2,
    mobile: viewport.name === "mobile",
  });
  return cdp;
}

/** Optional cross-check. A failed extract must not cost the PR its comment. */
async function readFinalState(tab: Tab): Promise<AgentRead | null> {
  try {
    return await tab.extract(
      "Read the checkout dialog. Return the primary button's label and the validation message under the cardholder name, or null if there is none.",
      AgentRead,
    );
  } catch {
    return null;
  }
}

async function inspectBranch({
  box,
  browser,
  url,
  label,
  log,
}: {
  box: Box;
  browser: Browser;
  url: string;
  label: string;
  log: Log;
}): Promise<BranchInspection> {
  const tab = await box.browser.tab.create(url, { waitUntil: "networkidle" });
  const page = findPage(browser, url);
  let browserTokens = 0;
  // Natural-language click first; a plain role click if the browser model is down or misses.
  const openCheckout = async () => {
    try {
      const result = await tab.act("Click the Upgrade Plan button");
      browserTokens += result.inputTokens + result.outputTokens;
      if (result.success) return;
    } catch {
      // fall through to the deterministic click
    }
    await page.getByRole("button", { name: "Upgrade Plan" }).click();
  };
  const inspectAt = async (viewport: Viewport) => {
    const cdp = await emulate(page, viewport);
    try {
      const report = await inspectCheckout({ page, viewport, openCheckout });
      await annotate(page, report);
      log(
        `${label.padEnd(6)} ${viewport.name.padEnd(7)} ${viewport.width}x${viewport.height} ${report.status.toUpperCase()} ` +
          `bottom=${Math.round(report.cta.rect.bottom * 10) / 10}px below_fold=${report.cta.overflowBelowFoldPx}px ` +
          `visible=${report.cta.visiblePercent}% submit=${report.submit.kind} console_errors=${report.consoleErrors.length}`,
      );
      return { report, png: await tab.screenshot() };
    } finally {
      await cdp.detach();
    }
  };
  try {
    const mobile = await inspectAt(VIEWPORTS[0]);
    const desktop = await inspectAt(VIEWPORTS[1]);
    const agentRead = await readFinalState(tab);
    return {
      run: { label, reports: { mobile: mobile.report, desktop: desktop.report } },
      shots: { mobile: mobile.png, desktop: desktop.png },
      agentRead,
      browserTokens,
    };
  } finally {
    await tab.close();
  }
}

/** Drives the box's Chromium: Box tabs for agent actions, Playwright over CDP for measurements. */
export async function inspectPreviews({
  box,
  pr,
  env,
  log,
}: {
  box: Box;
  pr: PullRequestRef;
  env: Env;
  log: Log;
}): Promise<Record<BranchKey, BranchInspection>> {
  const browser = await chromium.connectOverCDP(await box.browser.cdpUrl());
  try {
    const [base, head] = BRANCHES;
    return {
      before: await inspectBranch({ box, browser, url: `http://localhost:${base.port}${env.PREVIEW_PATH}`, label: pr.baseRef, log }),
      after: await inspectBranch({ box, browser, url: `http://localhost:${head.port}${env.PREVIEW_PATH}`, label: `PR #${pr.number}`, log }),
    };
  } finally {
    await browser.close();
  }
}

/** Claude Code in the box writes the verdict from the measurements; rules take over if it fails. */
export async function writeVerdict({
  box,
  pr,
  before,
  after,
  agentRead,
  log,
}: {
  box: Box;
  pr: PullRequestRef;
  before: BranchRun;
  after: BranchRun;
  agentRead: AgentRead | null;
  log: Log;
}): Promise<{ verdict: Verdict; verdictBy: string; runs: Run<unknown>[] }> {
  try {
    const run = await box.agent.run({
      prompt: buildVerdictPrompt({ prNumber: pr.number, title: pr.title, before, after, agentRead }),
      responseSchema: VerdictSchema,
      timeout: 120_000,
    });
    log(`Claude Code verdict: ${run.result.status.toUpperCase()} "${run.result.headline}"`);
    return { verdict: run.result, verdictBy: "Claude Code", runs: [run] };
  } catch (err) {
    const verdict = ruleBasedVerdict({ before, after });
    log(`agent verdict failed (${String(err)}); rule-based verdict: ${verdict.status.toUpperCase()}`);
    return { verdict, verdictBy: "Rule-based", runs: [] };
  }
}

/** Shallow shape check for a BranchRun read back from our own inspection.json. */
function isBranchRun(value: unknown): boolean {
  return typeof value === "object" && value !== null && "label" in value && "reports" in value;
}

export const BranchRunShape = z.custom<BranchRun>(isBranchRun);

/** Everything one run measured. Written to disk so CI steps and the blog can reuse it. */
export const InspectionFile = z.object({
  boxId: z.string(),
  restoreSeconds: z.number(),
  pr: z.object({ number: z.number(), baseSha: z.string(), headSha: z.string() }),
  before: BranchRunShape,
  after: BranchRunShape,
  agentRead: AgentRead.nullable(),
  browserTokens: z.number(),
  spend: z.object({ agentUsd: z.number(), computeMs: z.number() }),
});
export type InspectionFile = z.infer<typeof InspectionFile>;

export const SHOT_FILES = {
  beforeMobile: "before-mobile.png",
  afterMobile: "after-mobile.png",
  beforeDesktop: "before-desktop.png",
  afterDesktop: "after-desktop.png",
} as const satisfies Record<keyof Omit<ScreenshotUrls, "kind">, string>;

export async function saveInspection({
  dir,
  inspection,
  shots,
}: {
  dir: string;
  inspection: InspectionFile;
  shots: Record<BranchKey, Record<ViewportName, Uint8Array>>;
}): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, SHOT_FILES.beforeMobile), shots.before.mobile);
  await writeFile(join(dir, SHOT_FILES.afterMobile), shots.after.mobile);
  await writeFile(join(dir, SHOT_FILES.beforeDesktop), shots.before.desktop);
  await writeFile(join(dir, SHOT_FILES.afterDesktop), shots.after.desktop);
  await writeFile(join(dir, "inspection.json"), `${JSON.stringify(inspection, null, 2)}\n`);
}

export async function loadInspection(dir: string): Promise<InspectionFile> {
  return InspectionFile.parse(JSON.parse(await readFile(join(dir, "inspection.json"), "utf8")));
}

/** Screenshot URLs under a fixed base, such as raw.githubusercontent.com for a committed folder. */
export function screenshotsAt(base: string): ScreenshotUrls {
  const at = (file: string) => `${base.replace(/\/$/, "")}/${file}`;
  return {
    kind: "urls",
    beforeMobile: at(SHOT_FILES.beforeMobile),
    afterMobile: at(SHOT_FILES.afterMobile),
    beforeDesktop: at(SHOT_FILES.beforeDesktop),
    afterDesktop: at(SHOT_FILES.afterDesktop),
  };
}

/** Uploads the four PNGs in `dir` to a public Upstash Blob bucket, keyed by the head SHA. */
export async function uploadScreenshots({ dir, pr, token }: { dir: string; pr: PullRequestRef; token: string }): Promise<ScreenshotUrls> {
  const bucket = new Bucket({ token });
  const put = async (file: string): Promise<string> => {
    const blob = await bucket.put(`visual-qa/${pr.repo}/pr-${pr.number}/${pr.headSha}/${file}`, await readFile(join(dir, file)), {
      contentType: "image/png",
      cache: "immutable",
    });
    if (!blob.url) throw new Error("The Blob bucket is private. GitHub needs public image URLs; make the bucket public.");
    return blob.url;
  };
  return {
    kind: "urls",
    beforeMobile: await put(SHOT_FILES.beforeMobile),
    afterMobile: await put(SHOT_FILES.afterMobile),
    beforeDesktop: await put(SHOT_FILES.beforeDesktop),
    afterDesktop: await put(SHOT_FILES.afterDesktop),
  };
}
