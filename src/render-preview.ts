// Builds preview.html from blog-post.mdx so the post can be reviewed with every image, the video,
// highlighted code, and tables in one page, styled after the Upstash blog. Also writes
// blog-post.md (the same post with the video as a link instead of an MDX tag).
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import hljs from "highlight.js";
import { Marked } from "marked";
import { z } from "zod";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const VIDEO_TAG = /^<video src="([^"]+)" controls muted playsInline \/>$/m;

const Frontmatter = z.object({
  title: z.string(),
  slug: z.string(),
  authors: z.array(z.string()),
  date: z.string(),
  tags: z.array(z.string()),
});

function parseFrontmatter(source: string): { meta: z.infer<typeof Frontmatter>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!match?.[1]) throw new Error("blog-post.mdx has no frontmatter");
  const fields: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const [, key, raw] = /^(\w+):\s*(.*)$/.exec(line) ?? [];
    if (key && raw !== undefined) fields[key] = JSON.parse(raw);
  }
  return { meta: Frontmatter.parse(fields), body: source.slice(match[0].length) };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

const source = await readFile(join(ROOT, "blog-post.mdx"), "utf8");
const { meta, body } = parseFrontmatter(source);

await writeFile(
  join(ROOT, "blog-post.md"),
  source.replace(VIDEO_TAG, "[Watch the 28-second demo (1080p60 MP4)]($1)"),
);

const marked = new Marked({
  gfm: true,
  renderer: {
    code({ text, lang }) {
      const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
      let fileHeader = "";
      let codeBody = text;
      const firstLineMatch = /^(?:\/\/|#)\s*([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+(?:\s*&\s*[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)?)\n/.exec(text);
      if (firstLineMatch?.[1]) {
        fileHeader = `<span class="file">${esc(firstLineMatch[1])}</span>`;
        codeBody = text.slice(firstLineMatch[0].length);
      }
      const html = hljs.highlight(codeBody, { language }).value;
      return `<div class="code-wrap"><div class="code-bar">${fileHeader}<span class="lang">${esc(language)}</span></div><pre class="code"><code class="hljs language-${language}">${html}</code></pre></div>\n`;
    },
    image({ href, text }) {
      return `<figure><a href="${esc(href)}" target="_blank" rel="noopener"><img src="${esc(href)}" alt="${esc(text)}"></a><figcaption>${esc(text)}</figcaption></figure>`;
    },
  },
});

const article = await marked.parse(
  body.replace(VIDEO_TAG, '<figure class="video"><video src="$1" controls muted playsinline preload="metadata" poster="./artifacts/stills/pr-comment-recording-playing.png"></video></figure>'),
);
const date = new Date(`${meta.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const words = body.split(/\s+/).length;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)} | Upstash Blog</title>
<style>
  :root {
    --bg: #fafafa; --fg: #18181b; --muted: #71717a; --line: #e4e4e7; --soft: #f4f4f5;
    --emerald: #059669; --emerald-600: #047857; --emerald-50: #ecfdf5; --code-bg: #0f1117; --code-bar: #161922;
    --font: Inter, "Geist", ui-sans-serif, system-ui, sans-serif; --mono: "Geist Mono", "JetBrains Mono", ui-monospace, "SF Mono", monospace;
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 17px/1.75 var(--font); -webkit-font-smoothing: antialiased; }
  .nav { position: sticky; top: 0; z-index: 5; background: rgb(250 250 250 / .92); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); }
  .nav .in { max-width: 1120px; margin: 0 auto; padding: 14px 24px; display: flex; align-items: center; gap: 22px; font-size: 14.5px; }
  .brand { display: flex; align-items: center; gap: 9px; font-weight: 650; color: var(--fg); text-decoration: none; letter-spacing: -.01em; }
  .brand i { width: 22px; height: 22px; border-radius: 6px; background: linear-gradient(140deg, #34d399, #059669); display: block; }
  .nav a.l { color: var(--muted); text-decoration: none; }
  .nav .badge { margin-left: auto; font-size: 12px; font-weight: 600; color: var(--emerald-600); background: var(--emerald-50); border: 1px solid #a7f3d0; padding: 3px 10px; border-radius: 99px; }
  header.post { max-width: 768px; margin: 0 auto; padding: 64px 24px 28px; }
  .crumb { font-size: 14px; color: var(--emerald-600); font-weight: 600; text-decoration: none; }
  h1.title { font-size: clamp(32px, 4.6vw, 46px); line-height: 1.12; letter-spacing: -.028em; margin: 14px 0 22px; font-weight: 700; text-wrap: balance; }
  .byline { display: flex; align-items: center; gap: 12px; font-size: 15px; color: var(--muted); }
  .byline img { width: 40px; height: 40px; border-radius: 50%; }
  .byline b { color: var(--fg); font-weight: 600; display: block; line-height: 1.3; }
  .tags { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 18px; }
  .tags span { font-size: 12.5px; font-weight: 500; color: #3f3f46; background: var(--soft); border: 1px solid var(--line); border-radius: 99px; padding: 2px 10px; }
  article { max-width: 768px; margin: 0 auto; padding: 8px 24px 96px; }
  article h2 { font-size: 27px; line-height: 1.25; letter-spacing: -.02em; margin: 56px 0 14px; font-weight: 680; }
  article p, article li { color: #27272a; }
  article a { color: var(--emerald-600); text-underline-offset: 3px; }
  article strong { color: var(--fg); }
  article :not(pre) > code { font: .86em var(--mono); background: var(--soft); border: 1px solid var(--line); border-radius: 6px; padding: .1em .38em; color: #18181b; }
  article ul, article ol { padding-left: 1.3em; }
  article li { margin: 6px 0; }
  figure { margin: 28px -96px; }
  figure img, figure video { display: block; width: 100%; height: auto; border-radius: 14px; border: 1px solid var(--line); background: #fff; box-shadow: 0 1px 2px rgb(0 0 0 / .04), 0 12px 32px rgb(24 24 27 / .07); }
  figure.video video { aspect-ratio: 16 / 9; background: #f3f5f8; }
  figcaption { margin-top: 10px; font-size: 13.5px; line-height: 1.5; color: var(--muted); text-align: center; padding: 0 96px; }
  .code-wrap { margin: 24px 0; border-radius: 12px; overflow: hidden; border: 1px solid #27272a; background: var(--code-bg); box-shadow: 0 8px 24px rgb(0 0 0 / .08); }
  .code-bar { display: flex; align-items: center; justify-content: space-between; padding: 9px 16px; background: var(--code-bar); border-bottom: 1px solid #27272a; font: 500 12px var(--mono); color: #a1a1aa; }
  .code-bar .file { color: #e4e4e7; font-weight: 600; }
  .code-bar .lang { margin-left: auto; font: 600 11px var(--mono); color: #34d399; text-transform: uppercase; letter-spacing: .06em; background: rgb(16 185 129 / .12); border: 1px solid rgb(16 185 129 / .28); padding: 2px 8px; border-radius: 99px; }
  pre.code { margin: 0; background: var(--code-bg); color: #e4e4e7; padding: 18px 20px; overflow-x: auto; font: 13.5px/1.68 var(--mono); }
  pre.code code { font: inherit; background: none; border: 0; padding: 0; color: inherit; }
  .hljs-keyword, .hljs-built_in, .hljs-selector-tag { color: #c084fc; font-weight: 500; }
  .hljs-string, .hljs-attr .hljs-string, .hljs-template-variable { color: #34d399; }
  .hljs-number, .hljs-literal { color: #fb923c; }
  .hljs-comment { color: #71717a; font-style: italic; }
  .hljs-title, .hljs-title.function_, .hljs-title.class_ { color: #60a5fa; }
  .hljs-attr, .hljs-property, .hljs-variable { color: #f472b6; }
  .hljs-type, .hljs-params { color: #fcd34d; }
  .hljs-meta, .hljs-bullet { color: #38bdf8; }
  .hljs-subst { color: #e4e4e7; }
  .hljs-addition { color: #6ee7b7; background: rgb(16 185 129 / .14); display: inline-block; width: 100%; padding: 1px 6px; border-radius: 4px; }
  .hljs-deletion { color: #fca5a5; background: rgb(239 68 68 / .14); display: inline-block; width: 100%; padding: 1px 6px; border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 22px 0; font-size: 14.5px; line-height: 1.5; display: block; overflow-x: auto; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-weight: 600; color: var(--fg); background: var(--soft); border-top: 1px solid var(--line); }
  td code, th code { white-space: nowrap; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 48px 0; }
  .note { max-width: 768px; margin: 0 auto; padding: 0 24px 48px; font-size: 13px; color: var(--muted); }
  @media (max-width: 1000px) { figure { margin: 24px 0; } figcaption { padding: 0; } }
  @media (max-width: 640px) { body { font-size: 16px; } header.post { padding-top: 40px; } article h2 { font-size: 23px; } }
</style>
</head>
<body>
<nav class="nav"><div class="in"><a class="brand" href="#"><i></i>Upstash</a><a class="l" href="#">Blog</a><a class="l" href="https://github.com/leoisadev1/box-pr-visual-tester">Source</a><span class="badge">Draft preview</span></div></nav>
<header class="post">
  <a class="crumb" href="#">Blog</a>
  <h1 class="title">${esc(meta.title)}</h1>
  <div class="byline"><img src="assets/leodev.png" alt=""><div><b>Leo</b>@leodev | ${date} | ${Math.max(1, Math.round(words / 230))} min read</div></div>
  <div class="tags">${meta.tags.map((t) => `<span>${esc(t)}</span>`).join("")}</div>
</header>
<article>
${article}
</article>
<p class="note">Preview of <code>blog-post.mdx</code> for slug <code>${esc(meta.slug)}</code>. Images and video load from <code>./artifacts/</code>.</p>
</body>
</html>
`;
await writeFile(join(ROOT, "preview.html"), html);
console.info(`preview.html: ${(html.length / 1024).toFixed(0)} KB, ${words} words; blog-post.md synced`);
