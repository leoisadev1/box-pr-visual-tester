// A short side-by-side recording of the checkout flow on base and head, for the PR comment.
// It runs as its own pass with slowed-down actions, so the measurements in probe.ts stay exact.
// Output: recording.mp4 (H.264) and recording.gif (plays inline in a GitHub comment, which
// strips <video> tags that point anywhere but GitHub's own upload storage).
import { chromium, type Browser } from "playwright-core";
import { execFileSync } from "node:child_process";
import { mkdtemp, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Log } from "./box-stages.js";
import type { LocalPreview } from "./local-inspect.js";
import { annotate, inspectCheckout, VIEWPORTS } from "./probe.js";

export const RECORDING_FILES = { mp4: "recording.mp4", gif: "recording.gif" } as const;

const MOBILE = VIEWPORTS[0];
/** Playwright records CSS pixels, so frames are upscaled 2x with lanczos for readable text. */
const SCALE = 2;

/** Records the mobile checkout flow on one preview and returns the path of the .webm file. */
async function recordOne({ browser, preview, dir }: { browser: Browser; preview: LocalPreview; dir: string }): Promise<string> {
  const context = await browser.newContext({
    viewport: { width: MOBILE.width, height: MOBILE.height },
    isMobile: true,
    hasTouch: true,
    recordVideo: { dir, size: { width: MOBILE.width, height: MOBILE.height } },
  });
  const page = await context.newPage();
  await page.goto(preview.url, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const report = await inspectCheckout({
    page,
    viewport: MOBILE,
    openCheckout: () => page.getByRole("button", { name: "Upgrade Plan" }).click(),
  });
  await annotate(page, report);
  await page.waitForTimeout(1500);
  const video = page.video();
  await context.close();
  if (!video) throw new Error("Playwright did not record a video");
  return video.path();
}

/**
 * Records base and head, then stitches them side by side, base on the left. Needs ffmpeg.
 * Returns the paths written in `dir`.
 */
export async function recordComparison({
  before,
  after,
  dir,
  log,
}: {
  before: LocalPreview;
  after: LocalPreview;
  dir: string;
  log: Log;
}): Promise<{ mp4: string; gif: string }> {
  const work = await mkdtemp(join(tmpdir(), "visual-qa-rec-"));
  // slowMo spaces out every click and keystroke so a reviewer can follow the flow.
  const browser = await chromium.launch({ slowMo: 120 });
  let left: string;
  let right: string;
  try {
    left = await recordOne({ browser, preview: before, dir: work });
    right = await recordOne({ browser, preview: after, dir: work });
  } finally {
    await browser.close();
  }
  const mp4 = join(dir, RECORDING_FILES.mp4);
  const gif = join(dir, RECORDING_FILES.gif);
  const tmpMp4 = join(work, "side-by-side.mp4");
  // Pad the shorter clip with its last frame, then stack with a 24px gutter.
  const stack =
    `[0:v]scale=iw*${SCALE}:ih*${SCALE}:flags=lanczos,tpad=stop_mode=clone:stop_duration=3,setpts=PTS-STARTPTS[l];` +
    `[1:v]scale=iw*${SCALE}:ih*${SCALE}:flags=lanczos,tpad=stop_mode=clone:stop_duration=3,setpts=PTS-STARTPTS[r];` +
    "[l]pad=iw+48:ih:0:0:color=0xF6F8FA[lp];[lp][r]hstack=inputs=2:shortest=1,fps=30,format=yuv420p[v]";
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", left, "-i", right, "-filter_complex", stack, "-map", "[v]",
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-movflags", "+faststart", tmpMp4]);
  await rename(tmpMp4, mp4);
  await writeGif({ mp4, gif });
  log(`recorded the mobile flow on both branches -> ${RECORDING_FILES.mp4}, ${RECORDING_FILES.gif}`);
  return { mp4, gif };
}

/** Converts an MP4 into a GIF small enough for a PR comment, with a palette built from the clip. */
export async function writeGif({ mp4, gif, width = 760 }: { mp4: string; gif: string; width?: number }): Promise<void> {
  const palette = join(await mkdtemp(join(tmpdir(), "visual-qa-gif-")), "palette.png");
  const scale = `fps=10,scale=${width}:-1:flags=lanczos`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", mp4, "-vf", `${scale},palettegen=stats_mode=diff`, palette]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", mp4, "-i", palette, "-lavfi",
    `${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4`, gif]);
}
