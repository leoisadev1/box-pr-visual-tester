import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { z } from "zod";
import { prKey, PullRequestPayload, toPullRequestRef, type PullRequestRef } from "./github.js";
import { EnvSchema, visualTestPullRequest } from "./pr-visual-tester.js";

const WebhookEnv = EnvSchema.extend({
  GITHUB_WEBHOOK_SECRET: z.string().min(16),
  PORT: z.coerce.number().default(8787),
  /** Label that re-runs the check on demand; this is the "Run Visual QA" button in the PR sidebar. */
  VISUAL_QA_LABEL: z.string().default("visual-qa"),
});
const env = WebhookEnv.parse(process.env);

const PullRequestEvent = z.object({
  action: z.string(),
  label: z.object({ name: z.string() }).optional(),
  pull_request: PullRequestPayload,
});

const TRIGGERS = new Set(["opened", "synchronize", "reopened"]);

/** GitHub signs the raw body with HMAC SHA-256. Compare in constant time. */
function isSignedByGitHub({ body, signature }: { body: Buffer; signature: string | undefined }): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", env.GITHUB_WEBHOOK_SECRET).update(body).digest("hex")}`);
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

// One run per PR at a time. A push during a run replaces whatever was queued, and the older run
// skips its comment so stale results never overwrite newer ones.
const latest = new Map<string, PullRequestRef>();
const running = new Set<string>();

function enqueue(pr: PullRequestRef): "started" | "queued" {
  const key = prKey(pr);
  latest.set(key, pr);
  if (running.has(key)) return "queued";
  running.add(key);
  void drain(key);
  return "started";
}

async function drain(key: string): Promise<void> {
  try {
    let pr = latest.get(key);
    while (pr) {
      const sha = pr.headSha;
      await visualTestPullRequest({ env, pr, shouldPublish: () => latest.get(key)?.headSha === sha }).catch(
        (err: unknown) => console.error(JSON.stringify({ event: "visual_qa.failed", pr: key, sha, error: String(err) })),
      );
      const next = latest.get(key);
      if (next?.headSha === sha) {
        latest.delete(key);
        pr = undefined;
      } else {
        pr = next;
      }
    }
  } finally {
    running.delete(key);
  }
}

createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(404).end();
    return;
  }
  const body = await readBody(req);
  if (!isSignedByGitHub({ body, signature: req.headers["x-hub-signature-256"]?.toString() })) {
    res.writeHead(401).end("bad signature");
    return;
  }
  if (req.headers["x-github-event"] !== "pull_request") {
    res.writeHead(204).end();
    return;
  }

  const event = PullRequestEvent.safeParse(JSON.parse(body.toString("utf8")));
  if (!event.success) {
    res.writeHead(400).end("unexpected payload");
    return;
  }
  const { action, label, pull_request } = event.data;
  const wanted = TRIGGERS.has(action) || (action === "labeled" && label?.name === env.VISUAL_QA_LABEL);
  if (!wanted) {
    res.writeHead(204).end();
    return;
  }

  const pr = toPullRequestRef(pull_request);
  // Acknowledge within GitHub's 10 s window; the box run takes longer.
  const state = enqueue(pr);
  res.writeHead(202, { "content-type": "application/json" }).end(JSON.stringify({ pr: prKey(pr), sha: pr.headSha, state }));
}).listen(env.PORT, () => {
  console.info(JSON.stringify({ event: "webhook.listening", port: env.PORT }));
});
