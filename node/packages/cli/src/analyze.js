"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { buildScript } = require("../../core/src/matcher");

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);

function findNative() {
  const env = process.env.BEATCUT_NATIVE;
  if (env && fs.existsSync(env)) return env;
  const cand = [
    path.resolve(__dirname, "../../../../native/build/beatcut-native"),
    path.resolve(process.cwd(), "native/build/beatcut-native"),
    "/tmp/beatcut-native",
  ];
  const src = cand.find((c) => fs.existsSync(c));
  if (!src) throw new Error("beatcut-native not found; build native/ first");
  if (src === "/tmp/beatcut-native") return src;
  const copy = "/tmp/beatcut-native";
  // refresh the cached copy whenever the build output is newer, so a rebuild takes effect
  const stale = !fs.existsSync(copy) || fs.statSync(src).mtimeMs > fs.statSync(copy).mtimeMs;
  if (stale) {
    fs.copyFileSync(src, copy);
    fs.chmodSync(copy, 0o755);
  }
  return copy;
}

function runJson(bin, args) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || `native failed: ${args.join(" ")}`);
  return JSON.parse(r.stdout);
}

function ensureWav(audioPath, tmp) {
  const ext = path.extname(audioPath).toLowerCase();
  if (ext === ".wav") return audioPath;
  const out = path.join(tmp, "audio.wav");
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-i", audioPath, "-ac", "1", "-ar", "22050", "-sample_fmt", "s16", out],
    { encoding: "utf8" }
  );
  if (r.status !== 0) throw new Error(r.stderr || "ffmpeg wav convert failed");
  return out;
}

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

function probeVideo(p) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "json", p],
    { encoding: "utf8" }
  );
  if (r.status !== 0) return { duration: null, frame: null };
  let duration = null;
  try {
    duration = parseFloat(JSON.parse(r.stdout).format.duration);
  } catch (_) {}
  return { duration: Number.isFinite(duration) ? duration : null };
}

function collectMedia(mediaDir, bin, tmp) {
  const files = walk(mediaDir).sort();
  const items = [];
  let ni = 0,
    nv = 0;
  for (const p of files) {
    const ext = path.extname(p).toLowerCase();
    if (IMAGE_EXT.has(ext)) {
      ni += 1;
      const feat = runJson(bin, ["image", p]);
      items.push({
        id: `IMG_${String(ni).padStart(3, "0")}`,
        type: "image",
        path: path.resolve(p),
        duration: null,
        features: {
          brightness: feat.brightness,
          contrast: feat.contrast,
          saturation: feat.saturation,
          warmth: feat.warmth,
          sharpness: feat.sharpness,
          energy: feat.energy,
        },
      });
    } else if (VIDEO_EXT.has(ext)) {
      nv += 1;
      const { duration } = probeVideo(p);
      const frame = path.join(tmp, `v${nv}.jpg`);
      const t = duration ? Math.min(1, duration * 0.15) : 0.1;
      spawnSync("ffmpeg", ["-y", "-ss", String(t), "-i", p, "-frames:v", "1", frame], {
        encoding: "utf8",
      });
      let feat = { brightness: 0.5, contrast: 0.4, saturation: 0.4, warmth: 0.5, sharpness: 0.4, energy: 0.4 };
      if (fs.existsSync(frame)) {
        const j = runJson(bin, ["image", frame]);
        feat = {
          brightness: j.brightness,
          contrast: j.contrast,
          saturation: j.saturation,
          warmth: j.warmth,
          sharpness: j.sharpness,
          energy: j.energy,
        };
      }
      items.push({
        id: `VID_${String(nv).padStart(3, "0")}`,
        type: "video",
        path: path.resolve(p),
        duration,
        features: feat,
      });
    }
  }
  return items;
}

function analyze(opts) {
  const bin = findNative();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "beatcut-"));
  try {
    const wav = ensureWav(opts.audio, tmp);
    const audio = runJson(bin, ["audio", wav]);
    audio.path = path.resolve(opts.audio);
    const media = collectMedia(opts.media, bin, tmp);
    if (!media.length) throw new Error("no images/videos in media dir");
    return buildScript(audio, media, {
      everyN: opts.everyN,
      transition: opts.transition,
      minEventGap: opts.minEventGap,
      zoomMax: opts.zoomMax,
      fadeInMax: opts.fadeInMax,
      fadeInFrac: opts.fadeInFrac,
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { analyze };
