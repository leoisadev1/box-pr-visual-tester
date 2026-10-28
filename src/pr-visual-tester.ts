// End-to-end visual QA for one pull request in a single process: restore a box, serve both
// branches, inspect them in Box Browser, write a verdict, then publish or save the results.
//
//   npx tsx src/pr-visual-tester.ts snapshot <repo-url>
//   npx tsx src/pr-visual-tester.ts run <owner/repo> <pr-number>                 # Blob + PR comment
//   npx tsx src/pr-visual-tester.ts run <owner/repo> <pr-number> --out <dir>     # save locally only
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  addRuns,
  costLine,
  createBaseSnapshot,
  inspectPreviews,
  NO_SPEND,
  restoreBox,
  saveInspection,
  screenshotsAt,
  startPreviews,
  uploadScreenshots,
  writeVerdict,
  type Log,
} from "./box-stages.js";
import { EnvSchema, requireSnapshot, type Env } from "./env.js";
import { fetchPullRequest, upsertComment, type PullRequestRef } from "./github.js";
import { renderComment, type Verdict } from "./report.js";

export { EnvSchema, type Env } from "./env.js";
export { createBaseSnapshot } from "./box-stages.js";

const stamp = () => new Date().toISOString().slice(11, 19);
export const consoleLog: Log = (message) => console.info(`${stamp()}  ${message}`);

export type Output =
  /** Upload to Upstash Blob and upsert the PR comment. */
  | { kind: "publish" }
  /** Write screenshots, inspection.json, and pr-comment.md to `dir`. Images in the comment use `imageBase`. */
  | { kind: "local"; dir: string; imageBase: string };

/**
 * Boots base and head previews in a fresh box, inspects both, and publishes or saves the result.
 * `shouldPublish` lets the webhook drop the comment of a run that a newer push superseded.
 */
export async function visualTestPullRequest({
  env,
  pr,
  output = { kind: "publish" },
  shouldPublish = () => true,
  log = consoleLog,
}: {
  env: Env;
  pr: PullRequestRef;
  output?: Output;
  shouldPublish?: () => boolean;
  log?: Log;
}): Promise<Verdict> {
  const { box, restoreSeconds } = await restoreBox({ env, snapshotId: requireSnapshot(env), keepAlive: false, log });
  try {
    let spend = addRuns(NO_SPEND, await startPreviews({ box, pr, env, log }));
    const inspected = await inspectPreviews({ box, pr, env, log });
    const before = inspected.before.run;
    const after = inspected.after.run;
    const { verdict, verdictBy, runs } = await writeVerdict({ box, pr, before, after, agentRead: inspected.after.agentRead, log });
    spend = addRuns(spend, runs);
    const cost = costLine({ spend, env });
    const browserTokens = inspected.before.browserTokens + inspected.after.browserTokens;

    switch (output.kind) {
      case "local": {
        await saveInspection({
          dir: output.dir,
          inspection: {
            boxId: box.id,
            restoreSeconds,
            pr: { number: pr.number, baseSha: pr.baseSha, headSha: pr.headSha },
            before,
            after,
            agentRead: inspected.after.agentRead,
            browserTokens,
            spend,
          },
          shots: { before: inspected.before.shots, after: inspected.after.shots },
        });
        const body = renderComment({
          prNumber: pr.number,
          checkedIn: `Upstash Box \`${box.id}\``,
          before,
          after,
          verdict,
          verdictBy,
          shots: screenshotsAt(output.imageBase),
          cost,
        });
        await mkdir(output.dir, { recursive: true });
        await writeFile(join(output.dir, "pr-comment.md"), body);
        await writeFile(join(output.dir, "verdict.json"), `${JSON.stringify({ ...verdict, by: verdictBy }, null, 2)}\n`);
        log(`saved screenshots, inspection.json, verdict.json and pr-comment.md to ${output.dir}`);
        break;
      }
      case "publish": {
        if (!shouldPublish()) {
          log(`skipped publishing: a newer push superseded ${pr.headSha.slice(0, 7)}`);
          break;
        }
        if (!env.UPSTASH_BLOB_TOKEN) throw new Error("UPSTASH_BLOB_TOKEN is required to publish. Use --out to save locally.");
        const dir = join("/tmp", `visual-qa-${pr.number}-${pr.headSha.slice(0, 7)}`);
        await saveInspection({
          dir,
          inspection: {
            boxId: box.id,
            restoreSeconds,
            pr: { number: pr.number, baseSha: pr.baseSha, headSha: pr.headSha },
            before,
            after,
            agentRead: inspected.after.agentRead,
            browserTokens,
            spend,
          },
          shots: { before: inspected.before.shots, after: inspected.after.shots },
        });
        const shots = await uploadScreenshots({ dir, pr, token: env.UPSTASH_BLOB_TOKEN });
        log("uploaded 4 screenshots to Upstash Blob");
        const body = renderComment({ prNumber: pr.number, checkedIn: `Upstash Box \`${box.id}\``, before, after, verdict, verdictBy, shots, cost });
        await upsertComment({ token: env.GITHUB_TOKEN, botLogin: env.GITHUB_BOT_LOGIN, pr, body });
        log(`posted the visual review on ${pr.owner}/${pr.repo}#${pr.number}`);
        break;
      }
      default: {
        const _exhaustive: never = output;
        throw new Error(`unknown output ${String(_exhaustive)}`);
      }
    }
    log(
      `done: ${verdict.status.toUpperCase()} | restore ${restoreSeconds.toFixed(1)}s | ` +
        `${cost.activeCpuSeconds.toFixed(1)}s in-box command time | agent $${spend.agentUsd.toFixed(4)} | browser-model tokens ${browserTokens}`,
    );
    return verdict;
  } finally {
    await box.delete();
    log(`deleted ${box.id}`);
  }
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const env = EnvSchema.parse(process.env);
  const [command, target, prNumber, ...rest] = process.argv.slice(2);
  if (command === "snapshot" && target) {
    const id = await createBaseSnapshot({ env, repoUrl: target, log: consoleLog });
    console.info(`BOX_SNAPSHOT_ID=${id}`);
  } else if (command === "run" && target && prNumber) {
    const [owner = "", repo = ""] = target.split("/");
    const pr = await fetchPullRequest({ token: env.GITHUB_TOKEN, owner, repo, number: Number(prNumber) });
    consoleLog(`${owner}/${repo}#${pr.number} "${pr.title}" base ${pr.baseSha.slice(0, 7)} head ${pr.headSha.slice(0, 7)}`);
    const dir = flag(rest, "--out");
    const output: Output = dir ? { kind: "local", dir, imageBase: flag(rest, "--image-base") ?? "." } : { kind: "publish" };
    await visualTestPullRequest({ env, pr, output });
  } else {
    console.error("usage: pr-visual-tester snapshot <repo-url> | run <owner/repo> <pr-number> [--out <dir> [--image-base <url>]]");
    process.exit(1);
  }
}
