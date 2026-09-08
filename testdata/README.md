# BeatCut testdata

Fixtures for Milestone-Abnahme. Do not replace with random songs during unit tests.

## Audio (`audio/`)

All files: 8 bars, 4/4, mono, 22050 Hz, WAV PCM16. Downbeat louder.

| File | BPM | Beat interval | Expected beats | Accept BPM |
|---|---:|---:|---:|---|
| click_120bpm.wav | 120 | 0.5 s | see EXPECTED.json | 118–122 |
| click_90bpm.wav | 90 | 0.666… s | see EXPECTED.json | 88–92 |
| click_140bpm.wav | 140 | ~0.429 s | see EXPECTED.json | 138–142 |

Beat count may differ by ±1 (first/last onset).

Use **click_120bpm.wav** as the default CI fixture (M1, M3, M4).

## Images (`media/`)

Solids plus two contrast extremes. Expected qualitative ranges: `EXPECTED.json`.

| File | Why |
|---|---|
| black.jpg / white.jpg / gray.jpg | brightness + near-zero saturation |
| red.jpg | high saturation, warm |
| blue_cold.jpg | high saturation, cold |
| yellow_warm.jpg | warm |
| high_contrast.jpg | stripes → high contrast / energy |
| low_contrast.jpg | beige → low contrast / energy |

No videos on purpose (M3 must work with images only). Add a tiny mp4 later if you test `src_in`.

## Script (`scripts/example_8s.json`)

Handwritten valid script: 8 events, every 2 beats, first 8 seconds of the 120 BPM click.
Use for schema tests (M0) and render without running analyze (M4).
