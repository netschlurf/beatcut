"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || cmd).slice(-2000));
  return r;
}

const DEFAULT_ZOOM_MAX = 1.08; // subtle Ken Burns zoom, not a dramatic push-in
const DEFAULT_FADE_IN_MAX = 0.3;
const DEFAULT_FADE_IN_FRAC = 0.4;

// most segments zoom straight into the center; a minority pull off-center
// towards a corner so the sequence doesn't feel mechanically repetitive
const ZOOM_DIRECTIONS = [
  { fx: 0.5, fy: 0.5, w: 6 },
  { fx: 0.18, fy: 0.18, w: 1 },
  { fx: 0.82, fy: 0.18, w: 1 },
  { fx: 0.18, fy: 0.82, w: 1 },
  { fx: 0.82, fy: 0.82, w: 1 },
];
const ZOOM_DIRECTIONS_TOTAL_W = ZOOM_DIRECTIONS.reduce((s, d) => s + d.w, 0);

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// picks a stable (same script -> same result) pseudo-random zoom direction per segment
function pickZoomDirection(seedStr) {
  let bucket = hashSeed(seedStr) % ZOOM_DIRECTIONS_TOTAL_W;
  for (const d of ZOOM_DIRECTIONS) {
    if (bucket < d.w) return d;
    bucket -= d.w;
  }
  return ZOOM_DIRECTIONS[0];
}

// crop's out_w/out_h are only evaluated once at init (not per frame), so it can't
// animate a zoom - only zoompan can. Its "d" must equal the segment's own frame
// count so the ramp finishes exactly when the segment ends. Supersampling to 2x
// the output size before zoompan avoids the pixel-rounding jitter it otherwise
// produces when cropping a 1:1-scaled image, and using higher-quality x264
// settings avoids compression blockiness that reads as stutter on a slow zoom.
function buildEffectsFilter(frames, dur, fps, effects, seedStr) {
  const zoomMax = effects.zoomMax;
  const zoomInc = (zoomMax - 1) / Math.max(1, frames);
  const { fx, fy } = pickZoomDirection(seedStr);
  const zoom =
    `,zoompan=z='min(zoom+${zoomInc.toFixed(6)},${zoomMax})'` +
    `:d=${frames}:x='(iw-iw/zoom)*${fx}':y='(ih-ih/zoom)*${fy}':s=1920x1080:fps=${fps}`;
  const fadeDur = Math.min(effects.fadeInMax, dur * effects.fadeInFrac);
  const fade = fadeDur >= 0.03 ? `,fade=t=in:st=0:d=${fadeDur.toFixed(3)}` : "";
  return (
    "scale=3840:2160:force_original_aspect_ratio=decrease,pad=3840:2160:(ow-iw)/2:(oh-ih)/2" +
    zoom +
    fade +
    ",format=yuv420p"
  );
}

function render(scriptPath, outPath) {
  const script = JSON.parse(fs.readFileSync(scriptPath, "utf8"));
  if (!script.timeline || !script.timeline.length) throw new Error("empty timeline");
  const cfg = script.config || {};
  const effects = {
    zoomMax: cfg.zoom_max ?? DEFAULT_ZOOM_MAX,
    fadeInMax: cfg.fade_in_max ?? DEFAULT_FADE_IN_MAX,
    fadeInFrac: cfg.fade_in_frac ?? DEFAULT_FADE_IN_FRAC,
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "beatcut-r-"));
  const listFile = path.join(tmp, "list.txt");
  const segs = [];
  const total = script.timeline.length;
  const start = Date.now();
  const FPS = 30;
  try {
    script.timeline.forEach((ev, i) => {
      const media = script.media[ev.media_id];
      if (!media) throw new Error("unknown media " + ev.media_id);
      const seg = path.join(tmp, `seg_${String(i).padStart(4, "0")}.mp4`);
      // derive frame count from absolute boundaries (not per-segment duration) to avoid
      // cumulative rounding drift across many concatenated segments
      const nextT = i + 1 < total ? script.timeline[i + 1].t : ev.t + Math.max(0.12, ev.duration || 0.5);
      const startFrame = Math.round(ev.t * FPS);
      const endFrame = Math.max(startFrame + 1, Math.round(nextT * FPS));
      const frames = endFrame - startFrame;
      const dur = Math.max(0.12, ev.duration || 0.5);
      const vf = buildEffectsFilter(frames, dur, FPS, effects, `${ev.media_id}:${i}`);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[render] segment ${i + 1}/${total} (${ev.media_id}, ${dur.toFixed(2)}s, ${frames}f) elapsed=${elapsed}s`);
      if (media.type === "image") {
        run("ffmpeg", [
          "-y",
          "-loop",
          "1",
          "-i",
          media.path,
          "-frames:v",
          String(frames),
          "-vf",
          vf,
          "-an",
          "-preset",
          "medium",
          "-crf",
          "16",
          seg,
        ]);
      } else {
        const ss = ev.src_in != null ? ev.src_in : 0;
        run("ffmpeg", [
          "-y",
          "-ss",
          String(ss),
          "-i",
          media.path,
          "-frames:v",
          String(frames),
          "-vf",
          vf,
          "-an",
          "-preset",
          "medium",
          "-crf",
          "16",
          seg,
        ]);
      }
      segs.push(seg);
    });
    fs.writeFileSync(
      listFile,
      segs.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join("\n")
    );
    console.log(`[render] concatenating ${total} segments...`);
    const silent = path.join(tmp, "video.mp4");
    run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", silent]);
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    console.log(`[render] muxing audio...`);
    run("ffmpeg", [
      "-y",
      "-i",
      silent,
      "-i",
      script.audio.path,
      "-shortest",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      outPath,
    ]);
    console.log(`[render] done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { render };
