"use strict";

function transitionFor(energy, def) {
  if (def && def !== "auto") return def;
  if (energy < 0.25) return "fade";
  if (energy < 0.5) return "slide_in";
  if (energy < 0.75) return "zoom_in";
  return "flash";
}

function matchMedia(energy, pool, used) {
  let best = pool[0];
  let bestS = -1e9;
  for (const m of pool) {
    const vis = m.features.energy ?? 0.5;
    let s = 1 - Math.abs(vis - energy) - 0.15 * (used[m.id] || 0);
    if (energy >= 0.8 && m.type === "video") s += 0.12;
    if (energy < 0.35 && m.type === "image") s += 0.05;
    if (s > bestS) {
      bestS = s;
      best = m;
    }
  }
  return best;
}

function buildScript(audio, media, opt = {}) {
  const every = Math.max(1, opt.everyN || 1);
  const minGap = opt.minEventGap ?? 0.18;
  const defTr = opt.transition || "auto";
  const zoomMax = opt.zoomMax ?? 1.08;
  const fadeInMax = opt.fadeInMax ?? 0.3;
  const fadeInFrac = opt.fadeInFrac ?? 0.4;
  const selected = audio.beats.filter((_, i) => i % every === 0);
  const beats = [];
  let last = -999;
  for (const b of selected) {
    if (b.t - last >= minGap) {
      beats.push(b);
      last = b.t;
    }
  }
  const used = {};
  const timeline = [];

  function pushEvent(t, dur, energy, beatIndex, reasonPrefix) {
    const item = matchMedia(energy, media, used);
    used[item.id] = (used[item.id] || 0) + 1;
    const ev = {
      t: +t.toFixed(4),
      beat_index: beatIndex,
      energy: +energy.toFixed(4),
      action: "show",
      media_id: item.id,
      transition: transitionFor(energy, defTr),
      duration: +dur.toFixed(4),
      reason: `${reasonPrefix} (${energy.toFixed(2)}) → ${item.type} ${item.id}`,
    };
    if (item.type === "video" && item.duration) {
      const srcIn = Math.min(item.duration * 0.1, Math.max(0, item.duration - dur));
      ev.src_in = +srcIn.toFixed(4);
      ev.src_out = +Math.min(item.duration, srcIn + dur).toFixed(4);
    }
    timeline.push(ev);
  }

  // lead-in so the visuals start at t=0 with the audio instead of at the first beat
  if (beats.length && beats[0].t > 0.02) {
    pushEvent(0, beats[0].t, beats[0].energy, -1, "lead-in before first beat");
  }

  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    const nxt = i + 1 < beats.length ? beats[i + 1].t : audio.duration;
    const dur = Math.max(0.12, nxt - b.t);
    const energyLabel = b.energy < 0.33 ? "low" : b.energy < 0.66 ? "mid" : "high";
    pushEvent(b.t, dur, b.energy, b.index, `${energyLabel}-energy beat`);
  }
  const mediaMap = {};
  for (const m of media) mediaMap[m.id] = m;
  return {
    version: 1,
    audio: {
      path: audio.path,
      duration: +audio.duration.toFixed(4),
      sample_rate: audio.sample_rate,
      bpm_estimate: audio.bpm_estimate ?? null,
      beat_count: audio.beats.length,
    },
    config: {
      every_n_beats: every,
      default_transition: defTr,
      min_event_gap: minGap,
      zoom_max: zoomMax,
      fade_in_max: fadeInMax,
      fade_in_frac: fadeInFrac,
    },
    media: mediaMap,
    timeline,
  };
}

module.exports = { buildScript, matchMedia, transitionFor };
