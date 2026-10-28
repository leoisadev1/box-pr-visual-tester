// `npm start` for the demo app: serves app/ on $PORT, so the billing page is at /billing/.
import { fileURLToPath } from "node:url";
import { serveDirectory } from "./preview-server.js";

const port = Number(process.env.PORT ?? 3000);
const root = fileURLToPath(new URL("../app", import.meta.url));
await serveDirectory({ root, host: process.env.HOST ?? "127.0.0.1", port });
console.info(`serving ${root} on http://localhost:${port}/billing/`);
