# box-pr-visual-tester

An agent that visually tests every pull request with [Upstash Box](https://upstash.com/docs/box) and its built-in browser.

When a PR opens, it restores a Box from a snapshot, serves the base branch on `:3000` and the PR on `:3001` (both pinned to the event's commit SHAs), lets Claude Code click through checkout with `tab.act`, measures the primary button with Playwright over CDP, and posts one PR comment with before and after screenshots stored in Upstash Blob.

See it on a real pull request: [#1 Fix mobile overflow on billing checkout modal](https://github.com/leoisadev1/box-pr-visual-tester/pull/1).

![Architecture](artifacts/02-architecture-flow.png)

## What's in the repo

| Path | What it is |
| --- | --- |
| `app/billing/` | The demo app. On `main`, its checkout dialog clips "Confirm upgrade" 66px below the fold on a 390x844 phone. PR #1 fixes it. |
| `src/create-snapshot.ts` | One-time setup: a Node box with Chromium, the repo cloned, and a warm npm cache. Prints `BOX_SNAPSHOT_ID`. |
| `src/box-stages.ts` | The stages of one run: restore, serve both branches, inspect in Box Browser, verdict, save, upload. |
| `src/probe.ts` | Playwright probe: opens checkout, measures the CTA against the fold and every clipping ancestor, checks what covers it, submits with an empty name, measures again. |
| `src/report.ts` | Zod verdict schema, the deterministic fallback verdict, and the PR comment Markdown. |
| `src/github.ts` | SHA-pinned PR refs and a comment upsert that only edits the bot's own comment. |
| `src/pr-visual-tester.ts` | One-process runner: `run <owner/repo> <pr>` publishes, `--out <dir>` saves locally. |
| `src/ci.ts` | The same stages as separate steps, for GitHub Actions or a terminal. |
| `src/webhook.ts` | HMAC-verified GitHub webhook server that runs one check per PR at a time. |
| `src/local-inspect.ts` | The same probe in a local Chromium, used when no Box key is set. |
| `.github/workflows/visual-qa.yml` | The Actions version. Box mode with secrets, local Chromium mode without. |
| `fixtures/`, `render/`, `video/` | Inputs for the blog stills and the companion video. |
| `artifacts/` | Screenshots used in the blog post and the PR #1 review. |

## Run it

```bash
npm install
npm run typecheck
```

With an Upstash Box key (`UPSTASH_BOX_API_KEY`) and a GitHub token (`GITHUB_TOKEN`):

```bash
npx tsx src/create-snapshot.ts https://github.com/<owner>/<repo>    # prints BOX_SNAPSHOT_ID=...
export BOX_SNAPSHOT_ID=snap_...

# Save screenshots and the comment locally
npx tsx src/pr-visual-tester.ts run <owner>/<repo> <pr-number> --out ./visual-qa

# Or upload to Upstash Blob (UPSTASH_BLOB_TOKEN, public bucket) and comment on the PR
npx tsx src/pr-visual-tester.ts run <owner>/<repo> <pr-number>

# Or run it on every PR from a webhook (GITHUB_WEBHOOK_SECRET)
npm run webhook
```

Without a Box key, the step runner falls back to local Chromium with the same probe:

```bash
npx tsx src/ci.ts prepare <owner>/<repo> <pr-number>
npx tsx src/ci.ts serve
npx tsx src/ci.ts inspect
npx tsx src/ci.ts publish
npx tsx src/ci.ts cleanup
```

## GitHub Actions

`.github/workflows/visual-qa.yml` runs on `pull_request`. Add these repository secrets to use Upstash Box:

| Secret | Needed for |
| --- | --- |
| `UPSTASH_BOX_API_KEY` | Box mode |
| `BOX_SNAPSHOT_ID` | Box mode (from `create-snapshot.ts`) |
| `UPSTASH_BLOB_TOKEN` | Inline screenshots in the PR comment (public bucket) |

Without them, the workflow runs in local Chromium and writes the review to the job summary.

## License

MIT
