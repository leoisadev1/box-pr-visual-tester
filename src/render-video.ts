// Renders video/index.html to box-pr-tester-demo.mp4: 1920x1080, 60 fps, 28 s.
// Each frame is painted with window.__setTime(t) and captured with Playwright, so the output is
// identical on every run. Audio cues come from the page and are synthesized here.
//
//   tsx src/render-video.ts                 full render
//   tsx src/render-video.ts --stills 3,9.5  PNG previews of single moments into /tmp
import { chromium } from "playwright-core";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { z } from "zod";
import { serveDirectory } from "./preview-server.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HOST = "127.0.0.1";
const PORT = 3043;
const FPS = 60;
const DURATION = 28;
const SAMPLE_RATE = 48_000;
const OUT = join(ROOT, "box-pr-tester-demo.mp4");

const Cues = z.array(z.object({ t: z.number(), kind: z.enum(["click", "key", "up", "down", "post"]) }));
type Cue = z.infer<typeof Cues>[number];

/** Small seeded PRNG so the keystroke texture is the same on every render. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function synthesize(cues: Cue[]): Buffer {
  const n = SAMPLE_RATE * DURATION;
  const mix = new Float32Array(n);
  const rand = mulberry32(42);
  const add = (start: number, length: number, sample: (i: number, s: number) => number) => {
    const from = Math.round(start * SAMPLE_RATE);
    for (let i = 0; i < length && from + i < n; i++) mix[from + i]! += sample(i, i / SAMPLE_RATE);
  };
  for (const cue of cues) {
    switch (cue.kind) {
      case "click": {
        // Trackpad click: a short bright tick over a soft low body.
        let prev = 0;
        add(cue.t, 0.03 * SAMPLE_RATE, (_, s) => {
          const noise = rand() * 2 - 1;
          const hp = noise - prev;
          prev = noise;
          return hp * 0.22 * Math.exp(-s / 0.0012) + Math.sin(2 * Math.PI * 160 * s) * 0.16 * Math.exp(-s / 0.008);
        });
        break;
      }
      case "key": {
        const pitch = 2400 + rand() * 900;
        const gain = 0.05 + rand() * 0.025;
        add(cue.t, 0.02 * SAMPLE_RATE, (_, s) => {
          const noise = rand() * 2 - 1;
          return (noise * gain * 1.4 + Math.sin(2 * Math.PI * pitch * s) * gain * 0.5) * Math.exp(-s / 0.0018);
        });
        break;
      }
      case "up":
      case "down":
      case "post": {
        // Two soft sine notes. Rising for success, falling for failure.
        const notes = cue.kind === "down" ? [523.25, 392] : cue.kind === "up" ? [659.25, 987.77] : [587.33, 880];
        notes.forEach((freq, k) => {
          add(cue.t + k * 0.085, 0.32 * SAMPLE_RATE, (_, s) => {
            const env = Math.min(1, s / 0.006) * Math.exp(-s / 0.11);
            return (Math.sin(2 * Math.PI * freq * s) + 0.25 * Math.sin(4 * Math.PI * freq * s)) * 0.07 * env;
          });
        });
        break;
      }
      default: {
        const _exhaustive: never = cue.kind;
        throw new Error(`unknown cue ${String(_exhaustive)}`);
      }
    }
  }
  const pcm = Buffer.alloc(44 + n * 2);
  pcm.write("RIFF", 0);
  pcm.writeUInt32LE(36 + n * 2, 4);
  pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(SAMPLE_RATE, 24);
  pcm.writeUInt32LE(SAMPLE_RATE * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mix[i]!)) * 32767), 44 + i * 2);
  return pcm;
}

const stillsArg = process.argv.indexOf("--stills");
const stills = stillsArg > -1 ? (process.argv[stillsArg + 1] ?? "").split(",").map(Number) : null;

// Playwright's Chromium has no H.264 decoder, so the page plays a VP9 copy of the real recording
// with a keyframe on every frame, which lets each video frame seek exactly.
const webm = join(ROOT, "video", "recording.webm");
if (!existsSync(webm)) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", join(ROOT, "artifacts/pr-1/recording.mp4"),
    "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "24", "-g", "1", "-row-mt", "1", "-an", webm]);
}

const server = await serveDirectory({ root: ROOT, host: HOST, port: PORT });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => msg.type() === "error" && pageErrors.push(msg.text()));
  await page.goto(`http://${HOST}:${PORT}/video/index.html`);
  await page.waitForSelector("body[data-ready='1']", { timeout: 30_000 });
  const setTime = (t: number) =>
    page.evaluate((time) => (window as unknown as { __setTime: (t: number) => Promise<void> }).__setTime(time), t);

  if (stills) {
    for (const t of stills) {
      await setTime(t);
      const path = join(tmpdir(), `bpv-frame-${t.toFixed(2)}.png`);
      await page.screenshot({ path });
      console.info(path);
    }
  } else {
    const cues = Cues.parse(await page.evaluate(() => (window as unknown as { __cues: unknown }).__cues));
    const work = await mkdtemp(join(tmpdir(), "bpv-render-"));
    const wav = join(work, "cues.wav");
    await writeFile(wav, synthesize(cues));

    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-y", "-loglevel", "error",
        "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
        "-i", wav,
        "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-r", String(FPS),
        "-c:a", "aac", "-b:a", "160k",
        "-t", String(DURATION), "-movflags", "+faststart",
        OUT,
      ],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    const done = new Promise<void>((resolve, reject) =>
      ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))),
    );
    const frames = FPS * DURATION;
    for (let f = 0; f < frames; f++) {
      await setTime(f / FPS);
      const png = await page.screenshot({ type: "png" });
      if (!ffmpeg.stdin.write(png)) await new Promise((r) => ffmpeg.stdin.once("drain", r));
      if (f % 300 === 0) console.info(`frame ${f}/${frames}`);
    }
    ffmpeg.stdin.end();
    await done;
    await copyFile(OUT, join(ROOT, "artifacts", "box-pr-tester-demo.mp4"));
    console.info(`wrote ${OUT}`);
  }
  if (pageErrors.length > 0) throw new Error(`page errors: ${pageErrors.join(" | ")}`);
} finally {
  await browser.close();
  server.close();
}
