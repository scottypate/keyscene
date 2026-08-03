# Keyscene

**See the chords you're playing.** Keyscene listens to your MIDI keyboard
and shows the harmony in real time — the chord name with alternates and
Roman numeral, grand-staff notation, and an on-screen keyboard with every
sounding note named. Built for teaching, practice, and streaming: a
chrome-free Display mode drops straight into OBS.

- **Theory-correct names** — `G♭maj7sus2`, `Cm6/F`, `C7(no3)`; every
  sounding note accounted for, never a guess that ignores what you play.
- **Correct enharmonic spelling** — an E major triad in the key of C
  spells `E–G♯–B`, never `A♭`; the name, the staff, and the key labels
  always agree.
- **Key-aware analysis** — pick a key and get Roman numerals (`ii7`,
  `V65/V`, `♭VImaj7`), diatonic-aware ranking, and key-appropriate
  spelling.
- **Made for the camera** — movable, scalable display elements on a
  transparent or chroma-key background, sharp at any size.

## Install

Grab the installer for your platform from
[Releases](https://github.com/scottypate/keyscene/releases):

- **macOS**: open the `.dmg`, drag Keyscene to Applications.
- **Windows**: run the `.msi` or `setup.exe`.

Current builds are unsigned, so the OS will warn on first launch:

- macOS: right-click the app → **Open** → Open (or System Settings →
  Privacy & Security → "Open Anyway").
- Windows: SmartScreen → **More info** → **Run anyway**.

## Quick start

1. Plug in your MIDI keyboard and open Keyscene — it connects to the
   last-used (or only) device automatically. The device picker is in the
   toolbar.
2. Play. The chord card shows the best name plus alternate readings; the
   staff and keyboard track every note.
3. Optionally pick a **key** in the toolbar to get Roman numerals and
   key-aware spelling.
4. **No MIDI keyboard?** Type to play: `A`–`'` are the keys, `Z`/`X`
   shift octaves, `Space` is the sustain pedal.

## Display mode (OBS / screen sharing)

Press **Ctrl/Cmd+D** (or the Display button) for a chrome-free window
with just the elements:

- **Drag** any element to move it; **scroll** over it to resize.
- Pick a **background**: transparent, or a chroma color (green, magenta,
  blue) to key out in OBS.
- In OBS, add a **Window Capture** of "Keyscene Display". Use **on top**
  to keep it above your DAW, **click-through** to let clicks pass to the
  apps underneath (the Studio window stays available as your control
  surface).
- Save your arrangement as a **layout preset** from the toolbar.
- `Esc` returns to Studio.

## Settings

The gear icon in the toolbar:

| Setting | What it does |
| --- | --- |
| Accidentals | Automatic, prefer sharps, or prefer flats (no key selected) |
| Roman numerals | Textbook (`I, iii, V7`) or Quality (`I, IIIm, V7`) convention |
| Pedal-sustained notes | Include or exclude pedal-held notes from analysis |
| Keyboard size | 49 / 61 / 76 / 88 keys |
| MIDI channels | Listen to all channels or a single one |
| Theme | Light (default), Dark, and more — or fully custom colors and font |
| Chord hold | Anti-flicker: how long a name lingers when notes drop away |

## Troubleshooting

- **"Your MIDI device is in use" (Windows)** — on some Windows versions
  only one app can open a MIDI device. Close your DAW's MIDI input, or
  share the device through a free virtual port
  ([loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html));
  Keyscene shows step-by-step instructions when this happens.
- **Stuck notes** — Keyscene honors MIDI panic (CC 120 All Sound Off /
  CC 123 All Notes Off) if your controller can send it; reselecting the
  device in the toolbar also clears everything.

## Building from source

The UI must be built first: the app embeds `ui/studio/dist` at compile
time. Requires Rust (≥1.82) and Node 22.

```sh
cd ui && npm ci && npm run check && npm run build && cd ..
cargo build --workspace
cargo test --workspace
```

Development (hot-reloading UI):

```sh
cd ui && npm run dev &          # vite on :1420
cd crates/keyscene-app && cargo tauri dev
```

Production installers (`.dmg` / `.msi` / NSIS):

```sh
cd crates/keyscene-app && cargo tauri build
```

### Project layout

```tree
crates/
  keyscene-core/    # analysis engine (pure Rust, no I/O)
  keyscene-midi/    # device enumeration, input streams, note tracking
  keyscene-server/  # localhost overlay server (future)
  keyscene-app/     # desktop shell (Tauri 2)
ui/
  shared/           # rendering components (Keyboard, Staff, ChordCard, ...)
  studio/           # Studio + Display mode SPA
docs/
  engine-spec.md    # normative chord/spelling rules; test vectors mirror it
```

The engine's behavior is specified in
[`docs/engine-spec.md`](docs/engine-spec.md) and pinned by ~800 test
vectors generated from an independent reference implementation, plus
property tests (transposition/octave invariance) that run natively and
on WASM in CI.

## License

MIT — see [`LICENSE`](LICENSE).
