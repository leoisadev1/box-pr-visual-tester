import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
};

/** Serves a directory as a static site. Used for the main and PR #42 previews and for rendering. */
export async function serveDirectory({
  root,
  host,
  port,
}: {
  root: string;
  host: string;
  port: number;
}): Promise<Server> {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const relative = normalize(pathname.endsWith("/") ? `${pathname}index.html` : pathname);
    const file = join(base, relative);
    if (!file.startsWith(base)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(port, host, done);
  });
  return server;
}
