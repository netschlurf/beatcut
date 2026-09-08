#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { analyze } = require("./analyze");
const { render } = require("./render");

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  if (i < 0 || i + 1 >= process.argv.length) return def;
  return process.argv[i + 1];
}
function has(flag) {
  return process.argv.includes(flag);
}

function usage() {
  console.error(`usage:
  beatcut analyze --audio FILE --media DIR [--every-n N] [--min-gap SECONDS] [--transition auto] [--zoom MAX] [--fade-in SECONDS] -o script.json
  beatcut render script.json -o out.mp4`);
}

function main() {
  const cmd = process.argv[2];
  if (cmd === "analyze") {
    const audio = arg("--audio");
    const media = arg("--media");
    const out = arg("-o") || arg("--out") || "script.json";
    if (!audio || !media) {
      usage();
      process.exit(2);
    }
    const script = analyze({
      audio,
      media,
      everyN: parseInt(arg("--every-n", "1"), 10),
      minEventGap: parseFloat(arg("--min-gap", "0.18")),
      transition: arg("--transition", "auto"),
      zoomMax: parseFloat(arg("--zoom", "1.08")),
      fadeInMax: parseFloat(arg("--fade-in", "0.3")),
    });
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(script, null, 2));
    console.log(`wrote ${out} events=${script.timeline.length} bpm=${script.audio.bpm_estimate}`);
    return;
  }
  if (cmd === "render") {
    const script = process.argv[3];
    const out = arg("-o") || arg("--out") || "out.mp4";
    if (!script || has("-h")) {
      usage();
      process.exit(2);
    }
    render(script, path.resolve(out));
    console.log(`wrote ${out}`);
    return;
  }
  usage();
  process.exit(2);
}

main();
