# BeatCut — Product Brief für Copilot

Lies zuerst diese Datei, dann `MILESTONES.md`. Implementiere nur das, was der aktuelle Milestone verlangt. Erfinde keine Produktfeatures außerhalb dieses Briefs.

---

## Was BeatCut ist

BeatCut ist ein **lokales Schnitt-Werkzeug**, das aus vorhandenem Material automatisch ein **editierbares Videoscript** baut und daraus später ein MP4 rendert.

Es ist **kein** generatives KI-Video-Modell (kein Text-to-Video, kein Bild-erfinden).
Es ist **kein** CapCut-Klon mit Effekt-Marktplatz.
Es ist **kein** Cloud-Dienst. Alles läuft auf der Maschine des Nutzers.

Kernidee: Die Musik gibt das Raster. Bilder und Videos werden auf Beats und Intensität gelegt. Das Ergebnis ist zuerst ein JSON-Script, nicht direkt ein fertiges Video. Der Mensch kann das Script ändern. Danach wird gerendert.

Satz für Copilot: **Das Script ist die einzige Quelle der Wahrheit.** Analyse schreibt Script. Editor ändert Script. Renderer liest nur Script. Keine versteckte Parallel-Timeline.

---

## Problem

Jemand hat:

- einen Musiktitel (MP3/WAV)
- viele Fotos
- optional ein paar Videoclips

Er will daraus ein Musikvideo / Recap / Slideshow, bei dem Schnitte **zur Musik** sitzen. Manuelle Arbeit in Premiere/Resolve ist zu langsam. Bestehende Auto-Tools sind undurchsichtig oder nicht lokal editierbar.

---

## Zielnutzer (v1)

Der Autor selbst: Softwareentwickler, der lokal auf Windows oder Linux arbeitet, CLI akzeptiert, später ein schlichtes HTML-Frontend will.

Keine Multi-User-App, kein Account, keine Lizenzprüfung.

---

## Input (v1)

Genau drei Arten von Dateien, lokal:

1. **Ein Audio-Track** — MP3 oder WAV. Das ist die Zeitachse. Länge des fertigen Videos = Länge dieses Tracks.
2. **n Bilder** — jpg/png/webp/…
3. **n Videos** — mp4/mov/mkv/… (können 0 sein)

Keine Stock-Suche, kein Download, kein Prompt-Feld.

Konfiguration (CLI-Flags, später UI):

- `every_n_beats` — Event alle N erkannten Beats (Default 1)
- `default_transition` — `auto` oder fest (`cut`, `fade`, `slide_in`, `zoom_in`, `flash`, `hold`)
- `min_event_gap` — Mindestabstand zwischen Events in Sekunden

---

## Output (v1)

### 1. `script.json` (Pflicht, zuerst)

Maschinell und menschlich lesbare Timeline.

Pflichtfelder eines Events:

- `t` — Start in Sekunden auf der Audio-Zeitachse
- `beat_index` — Index des Beats in der Analyse
- `energy` — 0..1, Intensität an dieser Stelle
- `action` — v1 nur `show` (später `hold`)
- `media_id` — Schlüssel in `script.media`
- `transition` — siehe oben
- `duration` — bis zum nächsten Event bzw. Track-Ende
- `reason` — kurze Begründung für den Matcher (Debug, Editor)

Optional bei Video-Medien:

- `src_in`, `src_out` — Quelle in Sekunden innerhalb der Videodatei

Zusätzlich im Script:

- `audio` — Pfad, Duration, Sample-Rate, BPM-Schätzung, Beat-Count
- `media` — Map id → { type, path, duration?, features }
- `config` — die Flags, mit denen gebaut wurde
- `version` — Integer, aktuell 1

Das Script darf von Hand oder später im Editor geändert werden. Ein zweiter Render **muss** diese Änderungen zeigen.

### 2. `out.mp4` (Milestone Render)

- Bildfüllung: contain + pad (kein unkontrolliertes Crop außer später explizit)
- Auflösung v1 fest z.B. 1920×1080, 30 fps
- Audio = Originaltrack, nicht neu gemischt außer Pegel-Normalisierung falls nötig
- Transition v1 implementiert: mindestens `cut` und `fade`; unbekannte Transitions fallen auf `cut` zurück

---

## Verhalten der Pipeline

```
Audio  →  Beats, BPM, Energy-Kurve
Bilder →  VisualFeatures (Helligkeit, Kontrast, Sättigung, Wärme, Schärfe, visual_energy)
Videos →  Duration (ffprobe) + Features vom Keyframe (ffmpeg → Bildanalyse)
       →  Matcher (TypeScript): Beat-Energy ≈ visual_energy, Wiederholung bestrafen
       →  script.json
       →  ffmpeg liest Script → MP4
```

Matcher-Regeln v1 (nicht in C++):

- Score = `1 - abs(visual.energy - beat.energy) - 0.15 * reuseCount`
- `energy >= 0.8` → kleiner Bonus für Videos
- `energy < 0.35` → kleiner Bonus für Bilder
- nie crashen bei 0 Videos; nur Bilder verwenden
- ohne Medien: harter Fehler

Analyse-Qualität v1:

- Clicktrack 120 BPM muss BPM 118–122 liefern
- Beats dürfen ±1 zur Sollzahl liegen
- Kein Cloud-Modell, kein Python in der Ziellinie

---

## Was das Programm bewusst nicht tut (v1)

- keine Bild- oder Videogenerierung
- keine automatischen Untertitel, keine Voiceover
- keine Effektbibliothek, keine Templates aus dem Netz
- keine Benutzerverwaltung
- kein Überschreiben des Scripts durch den Renderer
- C++ kennt weder ffmpeg noch das Dateisystem-Layout des Projekts (außer den übergebenen Buffern/Pfaden der Analyse)
- Frontend existiert nicht, bis `analyze` und `render` als CLI stehen

---

## Technologiestack (verbindlich)

| Teil | Technik |
|---|---|
| Beat / RMS / Onset / Bildfeatures | C++20, CMake |
| Node-Anbindung | N-API, `node-addon-api` |
| Orchestrierung, Matcher, CLI, später HTTP | Node.js 22 + TypeScript |
| Encode / Decode / Keyframe | ffmpeg / ffprobe, nur von Node gestartet |
| Vertrag | `script.schema.json` + TS-Types 1:1 |
| UI später | HTML + JS, spricht nur mit Node-Backend |

Python-Prototyp unter `beatcut/` ist **Referenz**, nicht Produktionscode. Nicht erweitern, nicht als Runtime behalten.

---

## Öffentliche CLI (Ziel)

```bash
beatcut analyze --audio track.mp3 --media ./media --every-n 1 --transition auto -o script.json
beatcut render script.json -o out.mp4
```

Mehr Befehle erst, wenn diese zwei stehen.

Optional danach (Milestone 5), nie implizit in analyze/render:

```bash
beatcut llm script.json -o script.llm.json
```

Die LLM darf nur ein gültiges Script zurückgeben. Keine neuen Beat-Zeiten, kein Encode, kein Bild generieren. Ohne diesen Befehl: keine Netzwerkanfrage.

---

## Qualitätsmaßstab „v1 fertig“

Gegeben eine MP3, 20 Bilder, 0–3 Videos:

1. `analyze` schreibt valides Script gegen das Schema.
2. Events liegen auf Beats, Dichte folgt `every-n`.
3. Medien rotieren; dasselbe Bild nicht unnötig 20× hintereinander, außer zu wenig Medien.
4. `render` erzeugt MP4 in Tracklänge, Audio sync, Schnitte ±1 Frame an `t`.
5. Man ändert im Script ein `media_id` oder ein `t` — zweiter Render zeigt die Änderung.
6. Kein Wasserzeichen. `analyze` und `render` machen keine Netzwerkanfrage. LLM nur über explizites `beatcut llm`.

---

## Sprache im Code

- Identifiers, Schema-Keys, CLI-Flags: **Englisch**
- Kommentare kurz, englisch
- Nutzermeldungen der CLI: englisch oder deutsch, aber einheitlich (v1 englisch)

---

## Copilot-Arbeitsregel

1. Ein Milestone aus `MILESTONES.md` pro Änderungsschritt.
2. Schema-Felder nicht still hinzufügen. Erst Schema, dann Code.
3. Tests gegen `testdata/click_120bpm.wav`, sobald Audio-C++ existiert.
4. Wenn unsicher: kleineres Verhalten, Script-Format unverändert lassen.
