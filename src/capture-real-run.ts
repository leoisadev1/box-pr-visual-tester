// Runs the probe in local Chromium against the two fixture versions of the billing page and
// writes artifacts/ for the blog stills and the video. No Box key needed.
//   fixtures/main  -> http://127.0.0.1:3040  ("Confirm upgrade" clipped on mobile)
//   fixtures/pr-42 -> http://127.0.0.1:3041  (max-h-[85dvh] overflow-y-auto + sticky footer)
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { screenshotsAt } from "./box-stages.js";
import { inspectLocally } from "./local-inspect.js";
import { consoleLog } from "./pr-visual-tester.js";
import { serveDirectory } from "./preview-server.js";
import { renderComment, ruleBasedVerdict, type CostLine } from "./report.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ARTIFACTS = join(ROOT, "artifacts");
const HOST = "127.0.0.1";

/**
 * Box-side numbers for the companion video only. They are example values, not a measurement:
 * a real Box run fills them from `Run.cost` and the `Box.fromSnapshot` timer.
 */
export const EXAMPLE_BOX_RUN = {
  boxId: "box_01J9X7K2M8P4Q",
  snapshotRestoreSeconds: 1.4,
  cost: { totalUsd: 0.0038, activeCpuSeconds: 5.4, cpuHourUsd: 0.1 } satisfies CostLine,
};

const servers = await Promise.all([
  serveDirectory({ root: join(ROOT, "fixtures/main"), host: HOST, port: 3040 }),
  serveDirectory({ root: join(ROOT, "fixtures/pr-42"), host: HOST, port: 3041 }),
]);
try {
  const startedAt = new Date();
  const runs = await inspectLocally({
    before: { label: "main", url: `http://${HOST}:3040/` },
    after: { label: "PR #1", url: `http://${HOST}:3041/` },
    dir: ARTIFACTS,
    log: consoleLog,
  });
  const verdict = ruleBasedVerdict(runs);
  await writeFile(
    join(ARTIFACTS, "pr-comment.md"),
    renderComment({
      prNumber: 1,
      checkedIn: `local Chromium ${runs.chromium}`,
      before: runs.before,
      after: runs.after,
      verdict,
      verdictBy: "Rule-based",
      shots: screenshotsAt("."),
      cost: null,
    }),
  );
  await writeFile(
    join(ARTIFACTS, "run-metrics.json"),
    `${JSON.stringify(
      {
        generatedAt: startedAt.toISOString(),
        host: "ms-a2",
        chromium: runs.chromium,
        previews: { before: { label: "main", url: `http://${HOST}:3040/` }, after: { label: "PR #1", url: `http://${HOST}:3041/` } },
        measured: { before: runs.before, after: runs.after },
        verdict: { ...verdict, source: "ruleBasedVerdict (local Chromium run)" },
        box: {
          ...EXAMPLE_BOX_RUN,
          measured: false,
          note: "Example Box telemetry shown in the companion video. Not a measurement.",
        },
      },
      null,
      2,
    )}\n`,
  );
} finally {
  for (const server of servers) server.close();
}
