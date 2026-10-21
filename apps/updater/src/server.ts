import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Updater, UpdaterError } from "./updater.js";

const MAX_BODY = 4096;

export function isAuthorized(header: string | undefined, secret: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  // Compare fixed-length digests so neither length nor content leaks via timing.
  const a = createHash("sha256").update(header.slice(7)).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

function send(res: ServerResponse, code: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(data);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new UpdaterError(413, "Body too large");
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    throw new UpdaterError(400, "Invalid JSON");
  }
}

export function createUpdaterServer(updater: Updater, secret: string): Server {
  return createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://updater");
      try {
        if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true });
        if (!isAuthorized(req.headers.authorization, secret)) return send(res, 401, { error: "Unauthorized" });

        if (req.method === "GET" && url.pathname === "/status") {
          return send(res, 200, { ...updater.getStatus(), running: updater.isRunning() });
        }
        if (req.method === "GET" && url.pathname === "/check") {
          return send(res, 200, await updater.check());
        }
        if (req.method === "POST" && url.pathname === "/update") {
          const body = await readJson(req);
          const status = await updater.start(String(body.version ?? ""), { dryRun: body.dryRun === true });
          return send(res, 202, status);
        }
        return send(res, 404, { error: "Not found" });
      } catch (err) {
        const code = err instanceof UpdaterError ? err.status : 502;
        return send(res, code, { error: err instanceof Error ? err.message : String(err) });
      }
    })();
  });
}
