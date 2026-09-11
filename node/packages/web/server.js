// BeatCut web editor — zero-dependency local server.
// Serves the editor HTML and three small JSON/file endpoints.
// Local-only by design: reads/writes files by absolute path on this machine.
import http from "node:http";
import { readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..", ".."); // beatcut repo root
const PORT = Number(process.env.PORT || 4321);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, headers);
  res.end(body);
}

function safeAbs(p) {
  if (!p) return null;
  const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(ROOT, p);
  return abs;
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  // Static editor page
  if (pathname === "/" || pathname === "/index.html") {
    const html = await readFile(path.join(__dirname, "index.html"));
    return send(res, 200, html, { "content-type": MIME[".html"] });
  }

  // Parsed script JSON. ?path=<abs or repo-relative>. Defaults to repo out.json.
  if (pathname === "/api/script") {
    const p = safeAbs(url.searchParams.get("path")) || path.join(ROOT, "out.json");
    try {
      const raw = await readFile(p, "utf8");
      const data = JSON.parse(raw);
      return send(res, 200, JSON.stringify(data), { "content-type": MIME[".json"] });
    } catch (e) {
      return send(res, 404, JSON.stringify({ error: String(e.message || e) }), { "content-type": MIME[".json"] });
    }
  }

  // Raw file by absolute path — used for media thumbnails / preview / audio.
  if (pathname === "/api/file") {
    const p = safeAbs(url.searchParams.get("path"));
    if (!p) return send(res, 400, "missing path");
    try {
      await stat(p);
      const buf = await readFile(p);
      const ext = path.extname(p).toLowerCase();
      return send(res, 200, buf, { "content-type": MIME[ext] || "application/octet-stream" });
    } catch (e) {
      return send(res, 404, String(e.message || e));
    }
  }

  // Save edited script. Body: full JSON. ?path=<abs>.
  if (pathname === "/api/save" && req.method === "POST") {
    const p = safeAbs(url.searchParams.get("path")) || path.join(ROOT, "out.json");
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString("utf8");
    try {
      const data = JSON.parse(body);
      await writeFile(p, JSON.stringify(data, null, 2) + "\n", "utf8");
      return send(res, 200, JSON.stringify({ ok: true, path: p }), { "content-type": MIME[".json"] });
    } catch (e) {
      return send(res, 400, JSON.stringify({ error: String(e.message || e) }), { "content-type": MIME[".json"] });
    }
  }

  // List *.json in repo root for the file picker.
  if (pathname === "/api/list") {
    const { readdir } = await import("node:fs/promises");
    const files = (await readdir(ROOT)).filter((f) => f.endsWith(".json"));
    return send(res, 200, JSON.stringify({ root: ROOT, files }), { "content-type": MIME[".json"] });
  }

  return send(res, 404, "not found");
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => send(res, 500, String(e)));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`BeatCut editor: http://127.0.0.1:${PORT}/`);
  console.log(`repo root: ${ROOT}`);
  if (!existsSync(path.join(ROOT, "out.json"))) {
    console.log("hint: no out.json at repo root — open one via the picker (e.g. script.json)");
  }
});
