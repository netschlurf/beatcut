// BeatCut web editor — zero-dependency local server.
// Serves the editor HTML, file/script endpoints, and project pipeline (analyze/render).
// Local-only by design: reads/writes files by absolute path on this machine.
import http from "node:http";
import { readFile, writeFile, stat, mkdir, readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..", ".."); // beatcut repo root
const PROJECTS = path.join(ROOT, "projects");
const CLI = path.join(ROOT, "node", "packages", "cli", "src", "cli.js");
const NATIVE = path.join(ROOT, "native", "build", "beatcut-native");
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

// ---------- job system ----------
const jobs = new Map(); // id -> { status, log, result, proc }

function startJob(label, args, env, onDone) {
  const id = randomUUID().slice(0, 8);
  const job = { id, status: "running", log: "", result: null, error: null, label };
  jobs.set(id, job);
  // strip LD_LIBRARY_PATH from VSCode extensions that shadow system libs the native binary needs
  const clean = { ...process.env };
  delete clean.LD_LIBRARY_PATH;
  const fullEnv = { ...clean, ...env };
  const proc = spawn("node", args, { env: fullEnv, cwd: ROOT });
  job.proc = proc;
  const push = (s) => { job.log += s; };
  proc.stdout.on("data", (d) => push(d.toString()));
  proc.stderr.on("data", (d) => push(d.toString()));
  proc.on("close", (code) => {
    if (code === 0) { job.status = "done"; if (onDone) { try { job.result = onDone(); } catch (e) { job.status = "error"; job.error = String(e.message || e); } } }
    else { job.status = "error"; job.error = `exit ${code}`; }
  });
  proc.on("error", (e) => { job.status = "error"; job.error = String(e); });
  return id;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
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

  // ---- project pipeline ----

  // Create new project dir
  if (pathname === "/api/project/new" && req.method === "POST") {
    await mkdir(PROJECTS, { recursive: true });
    const id = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dir = path.join(PROJECTS, id);
    await mkdir(path.join(dir, "audio"), { recursive: true });
    await mkdir(path.join(dir, "media"), { recursive: true });
    return send(res, 200, JSON.stringify({ id, dir }), { "content-type": MIME[".json"] });
  }

  // Upload file into project. ?id=<projectId>&sub=audio|media&name=<filename>
  if (pathname === "/api/upload" && req.method === "POST") {
    const id = url.searchParams.get("id");
    const sub = url.searchParams.get("sub") || "media";
    const name = url.searchParams.get("name");
    if (!id || !name) return send(res, 400, JSON.stringify({ error: "id and name required" }), { "content-type": MIME[".json"] });
    const dir = path.join(PROJECTS, id, sub);
    await mkdir(dir, { recursive: true });
    const body = await readBody(req);
    const fp = path.join(dir, name);
    await writeFile(fp, body);
    return send(res, 200, JSON.stringify({ ok: true, path: fp }), { "content-type": MIME[".json"] });
  }

  // List files in a project sub-dir
  if (pathname === "/api/project/files") {
    const id = url.searchParams.get("id");
    const sub = url.searchParams.get("sub") || "media";
    if (!id) return send(res, 400, JSON.stringify({ error: "id required" }), { "content-type": MIME[".json"] });
    const dir = path.join(PROJECTS, id, sub);
    try {
      const files = (await readdir(dir)).sort();
      return send(res, 200, JSON.stringify({ files, dir }), { "content-type": MIME[".json"] });
    } catch (e) {
      return send(res, 200, JSON.stringify({ files: [], dir }), { "content-type": MIME[".json"] });
    }
  }

  // Run analysis. Body: { id, audio, params }
  if (pathname === "/api/analyze" && req.method === "POST") {
    const body = JSON.parse((await readBody(req)).toString("utf8"));
    const { id, audio, params } = body;
    if (!id || !audio) return send(res, 400, JSON.stringify({ error: "id and audio required" }), { "content-type": MIME[".json"] });
    const audioPath = path.join(PROJECTS, id, "audio", audio);
    const mediaDir = path.join(PROJECTS, id, "media");
    const scriptPath = path.join(PROJECTS, id, "script.json");
    const p = params || {};
    const args = [CLI, "analyze", "--audio", audioPath, "--media", mediaDir,
      "--every-n", String(p.every_n_beats || 1),
      "--min-gap", String(p.min_event_gap ?? 0.18),
      "--transition", String(p.default_transition || "auto"),
      "--zoom", String(p.zoom_max ?? 1.08),
      "--fade-in", String(p.fade_in_max ?? 0.3),
      "-o", scriptPath];
    const env = existsSync(NATIVE) ? { BEATCUT_NATIVE: NATIVE } : {};
    const jobId = startJob("analyze", args, env, () => {
      const raw = readFileSync(scriptPath, "utf8");
      return { script: JSON.parse(raw), scriptPath };
    });
    return send(res, 200, JSON.stringify({ jobId }), { "content-type": MIME[".json"] });
  }

  // Run render. Body: { scriptPath, outName? }
  if (pathname === "/api/render" && req.method === "POST") {
    const body = JSON.parse((await readBody(req)).toString("utf8"));
    const scriptPath = body.scriptPath || (body.id ? path.join(PROJECTS, body.id, "script.json") : null);
    if (!scriptPath) return send(res, 400, JSON.stringify({ error: "scriptPath or id required" }), { "content-type": MIME[".json"] });
    const outDir = body.id ? path.join(PROJECTS, body.id) : path.dirname(scriptPath);
    const outName = body.outName || "out.mp4";
    const outPath = path.join(outDir, outName);
    const args = [CLI, "render", scriptPath, "-o", outPath];
    const env = existsSync(NATIVE) ? { BEATCUT_NATIVE: NATIVE } : {};
    const jobId = startJob("render", args, env, () => ({ outPath }));
    return send(res, 200, JSON.stringify({ jobId }), { "content-type": MIME[".json"] });
  }

  // Poll job status
  if (pathname === "/api/job") {
    const id = url.searchParams.get("id");
    const job = jobs.get(id);
    if (!job) return send(res, 404, JSON.stringify({ error: "unknown job" }), { "content-type": MIME[".json"] });
    return send(res, 200, JSON.stringify({ id: job.id, status: job.status, log: job.log, result: job.result, error: job.error, label: job.label }), { "content-type": MIME[".json"] });
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
