# BeatCut (M0–M4)

Lokale Pipeline: Audio + Bilder/Videos → `script.json` → MP4.

```bash
cmake -S native -B native/build -DCMAKE_BUILD_TYPE=Release
cmake --build native/build

# falls das Dateisystem noexec ist:
cp native/build/beatcut-native /tmp/beatcut-native && chmod +x /tmp/beatcut-native
export BEATCUT_NATIVE=/tmp/beatcut-native

node node/packages/cli/src/cli.js analyze \
  --audio testdata/audio/click_120bpm.wav \
  --media testdata/media \
  --every-n 2 \
  -o testdata/scripts/generated.json

node node/packages/cli/src/cli.js render \
  testdata/scripts/generated.json \
  -o testdata/out/demo.mp4
```

Abnahme Clicktrack: BPM ≈ 120, 32 Beats in 16 s.
