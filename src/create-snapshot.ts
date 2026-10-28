// One-time setup: a Node box with Chromium, the repo cloned, and a warm npm cache.
//   npx tsx src/create-snapshot.ts https://github.com/<owner>/<repo>
// Prints BOX_SNAPSHOT_ID=... for your .env or your GitHub Actions secrets.
import { createBaseSnapshot } from "./box-stages.js";
import { EnvSchema } from "./env.js";
import { consoleLog } from "./pr-visual-tester.js";

const repoUrl = process.argv[2];
if (!repoUrl) {
  console.error("usage: create-snapshot <repo-url>");
  process.exit(1);
}
const env = EnvSchema.parse(process.env);
consoleLog(`creating a base snapshot for ${repoUrl}`);
const id = await createBaseSnapshot({ env, repoUrl, log: consoleLog });
console.info(`BOX_SNAPSHOT_ID=${id}`);
