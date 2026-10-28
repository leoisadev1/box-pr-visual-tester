import { z } from "zod";
import { COMMENT_MARKER } from "./report.js";

/** A full 40-character commit SHA. Branch names move; a SHA pins exactly what was tested. */
export const CommitSha = z.string().regex(/^[0-9a-f]{40}$/).brand<"CommitSha">();
export type CommitSha = z.infer<typeof CommitSha>;

export const PullRequestRefSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  baseRef: z.string(),
  baseSha: CommitSha,
  headRef: z.string(),
  headSha: CommitSha,
  /** Clone URL of the head repository. Differs from the base for PRs from forks. */
  headCloneUrl: z.string(),
  baseCloneUrl: z.string(),
});
export type PullRequestRef = z.infer<typeof PullRequestRefSchema>;

/** The `pull_request` object, shared by webhook payloads and `GET /repos/{o}/{r}/pulls/{n}`. */
export const PullRequestPayload = z.object({
  number: z.number(),
  title: z.string(),
  base: z.object({
    ref: z.string(),
    sha: CommitSha,
    repo: z.object({ name: z.string(), clone_url: z.string(), owner: z.object({ login: z.string() }) }),
  }),
  head: z.object({
    ref: z.string(),
    sha: CommitSha,
    repo: z.object({ clone_url: z.string() }),
  }),
});

export function toPullRequestRef(pr: z.infer<typeof PullRequestPayload>): PullRequestRef {
  return {
    owner: pr.base.repo.owner.login,
    repo: pr.base.repo.name,
    number: pr.number,
    title: pr.title,
    baseRef: pr.base.ref,
    baseSha: pr.base.sha,
    headRef: pr.head.ref,
    headSha: pr.head.sha,
    headCloneUrl: pr.head.repo.clone_url,
    baseCloneUrl: pr.base.repo.clone_url,
  };
}

/** Stable key for one pull request across repositories. */
export function prKey(pr: Pick<PullRequestRef, "owner" | "repo" | "number">): string {
  return `${pr.owner}/${pr.repo}#${pr.number}`;
}

export async function fetchPullRequest({
  token,
  owner,
  repo,
  number,
}: {
  token: string;
  owner: string;
  repo: string;
  number: number;
}): Promise<PullRequestRef> {
  const raw = await github({ token, method: "GET", path: `/repos/${owner}/${repo}/pulls/${number}` });
  return toPullRequestRef(PullRequestPayload.parse(raw));
}

const CommentPage = z.array(
  z.object({
    id: z.number(),
    body: z.string().nullable().optional(),
    user: z.object({ login: z.string() }).nullable(),
  }),
);

async function github({
  token,
  method,
  path,
  body,
}: {
  token: string;
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
}): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Creates the visual review comment, or edits the one a previous run left. Only a comment written
 * by `botLogin` counts, so a human quoting the marker can't redirect the bot's edits.
 */
export async function upsertComment({
  token,
  botLogin,
  pr,
  body,
}: {
  token: string;
  botLogin: string;
  pr: PullRequestRef;
  body: string;
}): Promise<void> {
  const base = `/repos/${pr.owner}/${pr.repo}/issues`;
  let previousId: number | undefined;
  for (let page = 1; previousId === undefined; page++) {
    const comments = CommentPage.parse(
      await github({ token, method: "GET", path: `${base}/${pr.number}/comments?per_page=100&page=${page}` }),
    );
    previousId = comments.find((c) => c.user?.login === botLogin && c.body?.includes(COMMENT_MARKER))?.id;
    if (comments.length < 100) break;
  }
  if (previousId !== undefined) {
    await github({ token, method: "PATCH", path: `${base}/comments/${previousId}`, body: { body } });
  } else {
    await github({ token, method: "POST", path: `${base}/${pr.number}/comments`, body: { body } });
  }
}
