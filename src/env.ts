import { z } from "zod";

/** Every setting the tester reads, validated once where the process starts. */
export const EnvSchema = z.object({
  UPSTASH_BOX_API_KEY: z.string().min(1),
  /** Public Upstash Blob bucket for screenshots. Without it, screenshots stay local or in the CI run. */
  UPSTASH_BLOB_TOKEN: z.string().min(1).optional(),
  /** Reads the PR, clones private repos, and posts the comment. */
  GITHUB_TOKEN: z.string().min(1),
  /** Login the token posts as. Only this account's marker comment gets edited. */
  GITHUB_BOT_LOGIN: z.string().default("github-actions[bot]"),
  /** Snapshot made by `src/create-snapshot.ts`. */
  BOX_SNAPSHOT_ID: z.string().min(1).optional(),
  /** Your own Anthropic key. Without it the box uses the Upstash-managed key. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  /** Command that serves the app on $PORT inside the box. */
  PREVIEW_START: z.string().default("npm start"),
  /** Page to inspect on each preview. */
  PREVIEW_PATH: z.string().default("/billing/"),
  /** Your Box plan's CPU price, used for the cost line in the comment. */
  BOX_CPU_HOUR_USD: z.coerce.number().default(0.1),
});
export type Env = z.infer<typeof EnvSchema>;

export function requireSnapshot(env: Env): string {
  if (!env.BOX_SNAPSHOT_ID) throw new Error("BOX_SNAPSHOT_ID is not set. Run `npx tsx src/create-snapshot.ts <repo-url>` first.");
  return env.BOX_SNAPSHOT_ID;
}
