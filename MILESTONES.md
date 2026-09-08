# BeatCut — Milestone-Plan

Ziel: aus **1 Audio + n Bilder + n Videos** ein **editierbares Script** erzeugen, später rendern und in einem Editor anzeigen.

Prinzip: **Script ist die Wahrheit.** Jeder Milestone liefert etwas Lauffähiges. Kein UI, bis das Script-Format und die Pipeline stehen.

---

## Technologiestack

| Schicht | Technik | Warum |
|---|---|---|
| DSP / Analyse | **C++20**, CMake | Beat, Onset, RMS, Features — hot path, deterministisch, später WASM oder Native-Addon |
| Native-Bridge | **N-API Addon** (`node-addon-api`) | Node ruft `analyzeAudio()`, `analyzeImage()` synchron oder Worker-Thread |
| Backend / Orchestration | **Node.js 22 + TypeScript** | Dateien, Script-Builder, Matcher, ffmpeg-Job, später HTTP-API |
| Render | **ffmpeg** (CLI, vom Backend gestartet) | Kein eigenes Encoder-Rad |
| Script | **JSON** (`script.schema.json`) | Editor, Diff, Copilot, Tests |
| Frontend (spät) | **HTML + JS** (erst Vanilla oder Vite), Backend bleibt Node | Timeline visualisiert nur das Script |
| LLM (optional, nach Render) | **Eigene Node-Schicht**, OpenAI-kompatible HTTP-API | Schreibt nur ein neues gültiges Script; nie Beats oder ffmpeg |
| Build | CMake (C++) + npm workspaces | Ein Repo, zwei Packages |
| Tests | GoogleTest (C++) + Vitest/Node assert (TS) | Fixtures: bekannter Clicktrack → erwartete BPM |

Nicht im ersten Wurf: Python, Electron, React-Zwang, Cloud-KI, Datenbank.

### Repo-Struktur (Ziel)

```
beatcut/
  docs/
    MILESTONES.md
    script.schema.json
  native/                 # C++
    CMakeLists.txt
    include/beatcut/
    src/
    tests/
  node/
    packages/
      core/               # TS: script types, matcher, pipeline
      addon/              # N-API wrapper um native/
      cli/                # beatcut analyze | render
      server/             # später HTTP
      llm/                # optional: script → script
      web/                # später Editor
  testdata/
    click_120bpm.wav
    media/
```

Node spricht nur über ein schmales C++-API:

```ts
analyzeAudio(path: string): AudioAnalysis
analyzeImage(path: string): VisualFeatures
analyzeVideoProxy(path: string, jpegFramePath: string, duration: number): VisualFeatures
```

Video-Dauer/Keyframe holt **ffmpeg/ffprobe** in Node, nicht in C++.

---

## Milestone 0 — Vertrag festnageln
**Dauer:** 0,5–1 Tag · **Deliverable:** Schema + leeres Repo

- [ ] `script.schema.json` (version, audio, media, timeline-events)
- [ ] TypeScript-Types 1:1 zum Schema (`Script`, `TimelineEvent`, `MediaItem`)
- [ ] Beispiel-`script.json` (handgeschrieben, 8 s, 4 Events)
- [ ] README: Befehle, die am Ende existieren sollen:
  - `beatcut analyze --audio a.mp3 --media ./m --every-n 1 -o script.json`
  - `beatcut render script.json -o out.mp4`

**Definition of Done:** Schema ist die Spec. Copilot darf Event-Felder nicht frei erfinden.

Event-Minimum:

```
t, beat_index, energy, action, media_id, transition, duration
optional: src_in, src_out, reason
```

Aktionen v1: `show`  
Transitions v1: `cut` | `fade` | `slide_in` | `zoom_in` | `flash` | `hold`

**Erwartung User / Tester / PO:** Noch kein Programm zum Klicken. Du prüfst Dateien im Repo: Schema, ein handgeschriebenes Beispiel-Script, Types. Abnahme = „so sieht ein fertiges Script aus, Felder stehen fest.“ Kein Audio, kein Video.

---

## Milestone 1 — C++ Audio-Kern
**Dauer:** 3–5 Tage · **Deliverable:** `beatcut_analyze` CLI (ohne Node)

Input: WAV (PCM, Node konvertiert MP3 → WAV via ffmpeg).  
Output: JSON `{ duration, bpm, beats: [{t, energy, strength}] }`

Algorithmen, in der Reihenfolge:

1. WAV laden (Header selbst oder `dr_wav.h` single-header)
2. Downmix mono, resample auf 22050 Hz (einfacher Linear- oder sinc-Resampler)
3. RMS-Kurve (frame 2048, hop 512), Perzentil-Normalisierung 0..1
4. Onset: STFT-Magnitude + Spectral Flux
5. Peak-Picking mit Min-Gap (~200 ms) und adaptivem Threshold
6. BPM = Median der Inter-Beat-Intervalle (Filter 50–180 BPM)
7. `energy` am Beat = Mix aus RMS und Onset-Stärke

**DoD:** Testdatei `click_120bpm.wav` → BPM 118–122, Beat-Anzahl ±1 zur Sollzahl.

Keine librosa-Abhängigkeit. Optional später: intern Tempo-Autocorrelation verbessern.

**Erwartung User / Tester / PO:** Ein kleines C++-Tool (oder Test), dem du eine WAV gibst. Du bekommst JSON: Dauer, BPM, Liste der Beat-Zeiten plus Energy. Mit dem Clicktrack 120 BPM siehst du, ob das Metronom stimmt. Noch keine Bilder, kein MP4. Abnahme = „die Musik ist verstanden.“

---

## Milestone 2 — C++ Bild-Features
**Dauer:** 1–2 Tage

Input: JPEG/PNG (stb_image oder Node gibt bereits RGB-Buffer 256px).  
Output: `{ brightness, contrast, saturation, warmth, sharpness, energy }`

Gleicher Feature-Satz wie im Prototyp, Werte 0..1.  
**DoD:** Unit-Tests auf synthetischen Flächen (schwarz, weiß, rot, grau) mit erwarteten Bereichen.

**Erwartung User / Tester / PO:** Für ein einzelnes Foto kommen Zahlen 0..1 (hell, kontrastreich, satt, warm, scharf, „Punch“). Schwarz ist dunkel, knalliges Rot hat hohe Sättigung. Noch keine Timeline. Abnahme = „das Programm sieht den Unterschied zwischen flauen und knalligen Bildern.“

---

## Milestone 3 — N-API Addon + Node-CLI `analyze`
**Dauer:** 2–3 Tage

- CMake baut `beatcut.node`
- TS-CLI:
  1. ffmpeg: MP3 → temp WAV
  2. native `analyzeAudio`
  3. Media-Ordner scannen
  4. Bilder → native `analyzeImage`
  5. Videos: ffprobe duration + ffmpeg 1 Frame → `analyzeImage`
  6. Matcher in **TypeScript** (leicht änderbar, kein C++ nötig)
  7. `script.json` schreiben

Matcher-Regeln v1:

- Score = `1 - |visual.energy - beat.energy| - 0.15 * reuseCount`
- energy ≥ 0.8 → Bonus für Videos
- `every_n` und `min_event_gap` als Flags

**DoD:** Ein Befehl erzeugt valides Script gegen das Schema. Demo-Clicktrack + 8 Bilder wie bisher.

**Erwartung User / Tester / PO:** Erster echter Workflow: `beatcut analyze --audio … --media … -o script.json`. Du öffnest das JSON und siehst Events auf Beats, zugewiesene Bilder/Videos, Energy, `reason`. Mit `--every-n 2` wird die Liste kürzer. Es gibt noch kein abspielbares Video. Abnahme = „aus meinem Ordner entsteht ein lesbares Schnitt-Script.“

---

## Milestone 4 — ffmpeg-Renderer
**Dauer:** 3–4 Tage · immer noch kein UI

`beatcut render script.json -o out.mp4`

Strategie (einfach, robust):

1. Pro Event ein Segment rendern (Bild als Loop oder Video-Trim `src_in/src_out`)
2. Auflösung fest (z.B. 1920×1080), `fps=30`, `scale+pad`
3. Transition v1 nur `cut` und `fade` (xfade). Rest als `cut` mappen, bis sie existieren
4. Segmente konkatenieren
5. Original-Audio darunter, Länge = `audio.duration`

**DoD:** `out.mp4` spielt, Bildwechsel sitzen auf den Script-`t`-Werten (±1 Frame), Audio sync.

**Erwartung User / Tester / PO:** Zweiter Befehl: `beatcut render script.json -o out.mp4`. Du spielst die Datei: Musik durchgängig, Bilder/Clips wechseln auf den Beats, Länge = Track. Du änderst im JSON ein Bild oder eine Zeit, renderst nochmal, die Änderung ist im Film. Cut und Fade funktionieren, andere Transitions dürfen noch Cut sein. Abnahme = „das Produkt ist zum ersten Mal vorzeigbar.“

---

## Milestone 5 — LLM-Pass (optional, Default aus)

**Dauer:** 2–3 Tage · **Voraussetzung:** M3 + M4 stehen. Nicht vorher anfangen.

Die LLM ersetzt weder Analyse noch Renderer. Sie bekommt ein **gültiges Script** und liefert ein **gültiges Script**.

```
beatcut analyze ... -o script.json          # immer ohne LLM
beatcut llm script.json -o script.llm.json  # optional
beatcut render script.llm.json -o out.mp4
```

### Vertrag

- Input: `script.json` (komplett) + Config (`BEATCUT_LLM_URL`, `BEATCUT_LLM_MODEL`, optional Key).
- Output: JSON, das gegen `script.schema.json` validiert.
- Verboten: neue `t`-Werte außerhalb der bestehenden Beat-Zeiten (±0). Die LLM darf Events mergen (`hold`), `media_id` tauschen, `transition` ändern, `reason` umschreiben — **keine erfundenen Beats**.
- Bei Schema-Fehler, Timeout oder unparseable Antwort: Original-Script unverändert zurück, Exit-Code ≠ 0, Logzeile.
- Kein Netz, wenn Flag/`llm`-Befehl nicht genutzt wird. Analyze/Render dürfen das Modell nicht implizit aufrufen.

### Prompt-Inhalt (kurz halten)

System: Rolle „Script-Editor“, Schema-Felder nennen, Verbot neuer Timestamps.  
User: `audio.duration`, `bpm_estimate`, kompakte Event-Liste (`t`, `energy`, `media_id`, `transition`), Media-Kurzfeatures (`energy`, `type`). Keine Bild-Binaries.

### DoD

- Ohne Env/URL: Befehl bricht klar ab, Analyze bleibt grün.
- Mit Mock-Server (fixe Antwort): Output validiert, alle `t` ⊆ Original-Beats.
- Kaputter Modell-Output → Fallback Original + Fehler.
- `render` des LLM-Scripts erzeugt weiterhin ein MP4.

Copilot-Prompt für diesen Schritt:

> Implement only Milestone 5 from MILESTONES.md. Do not call the LLM from analyze or render. Do not change C++. Validate output against script.schema.json. Reject any event whose t is not in the input beat set.

**Erwartung User / Tester / PO:** `analyze` und `render` verhalten sich wie vorher, ohne Netz. Mit gesetzter Modell-URL: `beatcut llm script.json -o script.llm.json` — zweites Script, gleiche Beat-Zeiten, andere Medien/Transitions möglich. Ohne URL: klarer Fehler, kein stilles Weitermachen. Unsinn vom Modell wird verworfen. Abnahme = „die LLM ist ein optionaler Lektor, nicht das Metronom.“

---

## Milestone 6 — Intensität steuert Dichte
**Dauer:** 1–2 Tage

- Energy-Kurve in Segmente: low / mid / high (Schwellen konfigurierbar)
- low → `every_n = 4` oder `hold`
- high → `every_n = 1`, Transition `flash`/`zoom_in`
- Script bekommt `segments: [{t0,t1,label,every_n}]`

**DoD:** Gleicher Track, zwei Configs, deutlich unterschiedliche Event-Dichte.

**Erwartung User / Tester / PO:** Derselbe Song, einmal „ruhig“, einmal „dicht“: im Script stehen Segmente (low/mid/high). In der Strophe weniger Wechsel, im Drop fast jeder Beat. Du siehst das im JSON und im gerenderten Film. Abnahme = „das Video atmet mit der Musik, nicht nur mit einem festen every-n.“

---

## Milestone 7 — HTTP-Backend (Node)
**Dauer:** 2 Tage

Nur lokal:

- `POST /analyze` multipart (audio + files) → `script.json`
- `POST /render` body = script → Job-Id → `GET /jobs/:id` → Datei
- Script und Media liegen in einem Project-Ordner

Kein Auth, kein Cloud-Upload.  
**DoD:** curl erzeugt Script und MP4.

**Erwartung User / Tester / PO:** Ein lokaler Server. Per curl oder später Browser: Dateien hochladen → Script zurück; Script schicken → MP4-Download. Kein Login, nichts in einer fremden Cloud. CLI bleibt parallel nutzbar. Abnahme = „die Pipeline ist eine API, nicht nur Terminal.“

---

## Milestone 8 — Editor-Frontend (HTML/JS)
**Dauer:** 4–7 Tage

Minimal:

- Waveform + Beat-Marker (Daten aus Script/Audio-Analyse)
- Event-Liste: t, media, transition, energy
- Click auf Event → Medium tauschen, `every_n` live neu bauen (Backend)
- Speichern = Script überschreiben
- Button Render

Kein Fancy-Canvas-Schnitt. Die Timeline **editiert JSON**.

**DoD:** Ein Event ändern, speichern, neu rendern, Änderung sichtbar.

**Erwartung User / Tester / PO:** Eine HTML-Seite gegen den lokalen Server: Waveform, Beat-Marker, Event-Liste. Du tauschst ein Medium, speicherst, klickst Render, siehst den neuen Film. Optional Button „LLM vorschlagen“ (intern `beatcut llm`). Kein Premiere-Klon. Abnahme = „ich kann das Script anfassen, ohne JSON in einem Editor zu öffnen.“

---

---

## Milestone 9 — Hartes Matching (optional)
Nur wenn v1 zu dumm wirkt.

- CLIP oder kleiner Embedding-Export als **separates** Native/ONNX-Modul
- Audio-Mood: spektrales Centroid, Band-Energy → Vektor
- Cosine-Similarity statt nur `visual.energy`

Eigenes Milestone, darf M0–M8 nicht blockieren.

**Erwartung User / Tester / PO:** Dieselben Befehle, aber die Bildwahl wirkt thematisch/mood-näher als nur Kontrast-vs-Energy. Nur abnehmen, wenn der Unterschied an 2–3 echten Songs sichtbar ist. Darf fehlen, v1 gilt trotzdem.

---

## Reihenfolge für Copilot (konkrete Tickets)

Arbeite immer **ein** Ticket, mit Testdaten.

1. Schema + TS-Types + Fixture-Script  
2. C++ WAV + RMS + JSON-Dump  
3. C++ Spectral Flux + Peaks + BPM-Test gegen Clicktrack  
4. C++ Image-Features + Tests  
5. N-API + `beatcut analyze`  
6. Matcher + `every-n`  
7. `beatcut render` cut-only  
8. fade via xfade  
9. Segmente nach Intensität  
10. `beatcut llm` Script→Script + Schema-Check  
11. HTTP analyze/render  
12. Statisches HTML: Script anzeigen  
13. Script editieren + re-render  

Prompt-Vorlage an Copilot:

> Implementiere nur Milestone X wie in MILESTONES.md. Ändere das Script-Schema nicht ohne Eintrag in script.schema.json. C++ bleibt frei von ffmpeg und Node-Logik. Matcher bleibt TypeScript.

---

## Was bewusst später kommt

- Voll-UI wie CapCut  
- KI-Bildverständnis über CLIP hinaus  
- GPU-Beat-Tracking  
- Windows-Installer  
- Linux/Windows-Unterschiede im Addon: CMake + `prebuild` erst nach M3

---

## Akzeptanzkriterium für „v1 fertig“

Gegeben: eine MP3, 20 Bilder, 3 Videos.

```
beatcut analyze --audio track.mp3 --media ./media --every-n 1 -o script.json
beatcut render script.json -o out.mp4
```

ergibt ein MP4 in Tracklänge, Schnitte auf Beats, Medien rotieren nach Intensität, Script ist von Hand editierbar und ein zweiter Render spiegelt die Edits.
