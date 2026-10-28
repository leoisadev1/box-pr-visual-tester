// The visual QA run split into steps, for GitHub Actions or a terminal. State lives in
// .visual-qa/state.json between steps.
//
// Mode is picked once in `prepare`: "box" when UPSTASH_BOX_API_KEY and BOX_SNAPSHOT_ID are set
// (Upstash Box + Box Browser), otherwise "local" (git worktrees + local Chromium, same probe).
//
//   npx tsx src/ci.ts prepare [<owner/repo> <pr-number>]   # args optional inside Actions
//   npx tsx src/ci.ts restore                              # box mode only
//   npx tsx src/ci.ts serve
//   npx tsx src/ci.ts inspect
//   npx tsx src/ci.ts publish [--image-base <url>]
//   npx tsx src/ci.ts cleanup
import { Box } from "@upstash/box";
import { spawn, execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { openSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  addRuns,
  costLine,
  inspectPreviews,
  restoreBox,
  saveInspection,
  screenshotsAt,
  startPreviews,
  uploadScreenshots,
  writeVerdict,
  BRANCHES,
  BranchRunShape,
} from "./box-stages.js";
import { EnvSchema, requireSnapshot, type Env } from "./env.js";
import { fetchPullRequest, PullRequestPayload, PullRequestRefSchema, toPullRequestRef, upsertComment, type PullRequestRef } from "./github.js";
import { inspectLocally } from "./local-inspect.js";
import { consoleLog as log } from "./pr-visual-tester.js";
import { renderComment, ruleBasedVerdict, type Screenshots } from "./report.js";

const WORK = resolve(".visual-qa");
const OUT = join(WORK, "out");
const STATE = join(WORK, "state.json");

const StateSchema = z.object({
  mode: z.enum(["box", "local"]),
  pr: PullRequestRefSchema,
  boxId: z.string().nullable(),
  restoreSeconds: z.number().nullable(),
  spend: z.object({ agentUsd: z.number(), computeMs: z.number() }),
  /** Local mode: preview server process ids, for cleanup. */
  pids: z.array(z.number()),
  verdict: z
    .object({ status: z.enum(["pass", "fail"]), headline: z.string(), summary: z.string(), regressions: z.array(z.string()), by: z.string() })
    .nullable(),
  checkedIn: z.string().nullable(),
});
type State = z.infer<typeof StateSchema>;

/** Both modes write before/after into inspection.json. */
const SavedRuns = z.object({ before: BranchRunShape, after: BranchRunShape });

const readState = async (): Promise<State> => StateSchema.parse(JSON.parse(await readFile(STATE, "utf8")));
const writeState = async (state: State) => writeFile(STATE, `${JSON.stringify(state, null, 2)}\n`);

/** Env for local mode: no Box key needed, so only GitHub is required. */
const LocalEnv = z.object({ GITHUB_TOKEN: z.string().min(1) });

function pickMode(): "box" | "local" {
  return process.env.UPSTASH_BOX_API_KEY && process.env.BOX_SNAPSHOT_ID ? "box" : "local";
}

function boxEnv(): Env {
  return EnvSchema.parse(process.env);
}

async function resolvePullRequest(args: string[]): Promise<PullRequestRef> {
  const [target, number] = args;
  const { GITHUB_TOKEN } = LocalEnv.parse(process.env);
  if (target && number) {
    const [owner = "", repo = ""] = target.split("/");
    return fetchPullRequest({ token: GITHUB_TOKEN, owner, repo, number: Number(number) });
  }
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("Pass <owner/repo> <pr-number>, or run inside a pull_request workflow.");
  const event = z.object({ pull_request: PullRequestPayload }).parse(JSON.parse(await readFile(eventPath, "utf8")));
  return toPullRequestRef(event.pull_request);
}

function git(args: string[], cwd = "."): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function waitFor(url: string, timeoutMs = 60_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} did not answer within ${timeoutMs / 1000}s`);
}

const PREVIEW_PATH = process.env.PREVIEW_PATH ?? "/billing/";

const commands: Record<string, (args: string[]) => Promise<void>> = {
  async prepare(args) {
    await mkdir(OUT, { recursive: true });
    const pr = await resolvePullRequest(args);
    const mode = pickMode();
    log(`${pr.owner}/${pr.repo}#${pr.number} "${pr.title}"`);
    log(`base ${pr.baseRef} @ ${pr.baseSha.slice(0, 7)} | head ${pr.headRef} @ ${pr.headSha.slice(0, 7)}`);
    log(mode === "box" ? "mode: box (Upstash Box + Box Browser)" : "mode: local (no UPSTASH_BOX_API_KEY; local Chromium, same probe)");
    await writeState({ mode, pr, boxId: null, restoreSeconds: null, spend: { agentUsd: 0, computeMs: 0 }, pids: [], verdict: null, checkedIn: null });
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `mode=${mode}\n`);
  },

  async restore() {
    const state = await readState();
    if (state.mode !== "box") throw new Error("restore runs in box mode only");
    const env = boxEnv();
    const { box, restoreSeconds } = await restoreBox({ env, snapshotId: requireSnapshot(env), keepAlive: true, log });
    await writeState({ ...state, boxId: box.id, restoreSeconds });
  },

  async serve() {
    const state = await readState();
    if (state.mode === "box") {
      const box = await Box.get(z.string().parse(state.boxId));
      const runs = await startPreviews({ box, pr: state.pr, env: boxEnv(), log });
      await writeState({ ...state, spend: addRuns(state.spend, runs) });
      return;
    }
    const pids: number[] = [];
    for (const branch of BRANCHES) {
      const sha = branch.key === "after" ? state.pr.headSha : state.pr.baseSha;
      const dir = join(WORK, branch.folder);
      await rm(dir, { recursive: true, force: true });
      git(["worktree", "prune"]);
      git(["fetch", "--quiet", "--depth", "1", "origin", sha]);
      git(["worktree", "add", "--quiet", "--detach", dir, sha]);
      if (git(["rev-parse", "HEAD"], dir) !== sha) throw new Error(`${dir} is not at ${sha}`);
      execFileSync("npm", ["ci", "--prefer-offline", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: dir, stdio: "ignore" });
      const logFile = openSync(join(WORK, `${branch.folder}.log`), "w");
      const child = spawn("npm", ["start"], {
        cwd: dir,
        env: { ...process.env, PORT: String(branch.port), HOST: "127.0.0.1" },
        detached: true,
        stdio: ["ignore", logFile, logFile],
      });
      child.unref();
      if (child.pid) pids.push(child.pid);
      log(`${branch.folder.padEnd(4)} ${sha.slice(0, 7)} -> worktree ${branch.folder}/, npm ci, npm start -> localhost:${branch.port}`);
    }
    await Promise.all(BRANCHES.map((b) => waitFor(`http://127.0.0.1:${b.port}${PREVIEW_PATH}`)));
    log(`both previews answer on ${PREVIEW_PATH}`);
    await writeState({ ...state, pids });
  },

  async inspect() {
    const state = await readState();
    if (state.mode === "box") {
      const env = boxEnv();
      const box = await Box.get(z.string().parse(state.boxId));
      const inspected = await inspectPreviews({ box, pr: state.pr, env, log });
      const { verdict, verdictBy, runs } = await writeVerdict({
        box,
        pr: state.pr,
        before: inspected.before.run,
        after: inspected.after.run,
        agentRead: inspected.after.agentRead,
        log,
      });
      const spend = addRuns(state.spend, runs);
      await saveInspection({
        dir: OUT,
        inspection: {
          boxId: box.id,
          restoreSeconds: state.restoreSeconds ?? 0,
          pr: { number: state.pr.number, baseSha: state.pr.baseSha, headSha: state.pr.headSha },
          before: inspected.before.run,
          after: inspected.after.run,
          agentRead: inspected.after.agentRead,
          browserTokens: inspected.before.browserTokens + inspected.after.browserTokens,
          spend,
        },
        shots: { before: inspected.before.shots, after: inspected.after.shots },
      });
      await writeState({ ...state, spend, verdict: { ...verdict, by: verdictBy }, checkedIn: `Upstash Box \`${box.id}\`` });
      return;
    }
    const runs = await inspectLocally({
      before: { label: state.pr.baseRef, url: `http://127.0.0.1:3000${PREVIEW_PATH}` },
      after: { label: `PR #${state.pr.number}`, url: `http://127.0.0.1:3001${PREVIEW_PATH}` },
      dir: OUT,
      log,
    });
    const verdict = ruleBasedVerdict(runs);
    log(`rule-based verdict: ${verdict.status.toUpperCase()} "${verdict.headline}"`);
    await writeFile(
      join(OUT, "inspection.json"),
      `${JSON.stringify({ chromium: runs.chromium, pr: { number: state.pr.number, baseSha: state.pr.baseSha, headSha: state.pr.headSha }, before: runs.before, after: runs.after }, null, 2)}\n`,
    );
    await writeState({ ...state, verdict: { ...verdict, by: "Rule-based" }, checkedIn: `local Chromium ${runs.chromium}` });
  },

  async publish(args) {
    const state = await readState();
    if (!state.verdict || !state.checkedIn) throw new Error("run inspect first");
    const { by, ...verdict } = state.verdict;
    const i = args.indexOf("--image-base");
    const imageBase = i > -1 ? args[i + 1] : undefined;
    const runUrl =
      process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
        ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : null;

    const { before, after } = SavedRuns.parse(JSON.parse(await readFile(join(OUT, "inspection.json"), "utf8")));

    let shots: Screenshots;
    if (imageBase) shots = screenshotsAt(imageBase);
    else if (state.mode === "box" && process.env.UPSTASH_BLOB_TOKEN) {
      shots = await uploadScreenshots({ dir: OUT, pr: state.pr, token: process.env.UPSTASH_BLOB_TOKEN });
      log("uploaded 4 screenshots to Upstash Blob");
    } else if (runUrl) shots = { kind: "attached", label: "attached to the workflow run", url: runUrl };
    else shots = screenshotsAt(".");

    const body = renderComment({
      prNumber: state.pr.number,
      checkedIn: state.checkedIn,
      before,
      after,
      verdict,
      verdictBy: by,
      shots,
      cost: state.mode === "box" ? costLine({ spend: state.spend, env: boxEnv() }) : null,
    });
    await writeFile(join(OUT, "pr-comment.md"), body);
    log(`wrote ${join(".visual-qa/out", "pr-comment.md")}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `${body}\n`);
      log("wrote the review to the job summary");
    }
    if (state.mode === "box") {
      const env = boxEnv();
      await upsertComment({ token: env.GITHUB_TOKEN, botLogin: env.GITHUB_BOT_LOGIN, pr: state.pr, body });
      log(`posted the visual review on ${state.pr.owner}/${state.pr.repo}#${state.pr.number}`);
    }
  },

  async cleanup() {
    const state = await readState().catch(() => null);
    if (!state) return;
    if (state.mode === "box" && state.boxId) {
      await (await Box.get(state.boxId)).delete();
      log(`deleted ${state.boxId}`);
    }
    for (const pid of state.pids) {
      try {
        process.kill(-pid);
      } catch {
        // already gone
      }
    }
    for (const branch of BRANCHES) await rm(join(WORK, branch.folder), { recursive: true, force: true });
    git(["worktree", "prune"]);
    if (state.pids.length > 0) log(`stopped ${state.pids.length} preview servers and removed the worktrees`);
  },
};

const [name = "", ...args] = process.argv.slice(2);
const command = commands[name];
if (!command) {
  console.error(`usage: ci.ts ${Object.keys(commands).join(" | ")}`);
  process.exit(1);
}
await command(args);
