# Project Plan: Keyscene — Theory-Aware MIDI Chord Visualizer

Desktop application for Windows and macOS that displays real-time chord analysis, notation, and keyboard visualization from MIDI input, with a first-class "Display mode" for streamers, YouTube educators, and classrooms.

**Name status**: "Keyscene" cleared preliminary vetting (no software products, no trademark hits in searchable indexes, no active brand conflicts; keyscene.com is parked for sale at $995 on GoDaddy). Pending before public launch, owner to complete: official USPTO/UKIPO/EUIPO Class 9 + 41 searches, domain purchase, social/GitHub handle registration. The name doubles as product language: piano keys + OBS scenes. Agents should use `keyscene` for all identifiers, bundle IDs (e.g., `com.keyscene.app`), and repo naming.

This document is the source of truth for coding agents. Read fully before starting any phase. Do not expand scope beyond what is written here without explicit approval.

---

## 1. Product definition

### 1.1 What we are building

One engine, two faces:

- **Studio mode** — interactive windowed app. Play a MIDI keyboard and see: chord name(s), grand staff notation, on-screen keyboard, key context (Roman numerals). Browse chords in reverse (click a chord → see the keys). Capture progressions and export MIDI.
- **Display mode** — the same visual elements stripped of all chrome for screen capture: borderless window, individually toggleable/repositionable elements, themeable, chroma-key or transparent background, plus a localhost overlay server so OBS browser sources can render it with true alpha.

### 1.2 Who it is for (priority order)

1. Content creators: YouTube piano tutorial makers, Twitch piano streamers.
2. Music teachers: online lessons (Zoom screen share) and classroom projectors.
3. Producers/learners: people who play chords but don't know the names; people learning theory from their own playing.

### 1.3 Competitive requirements (these are hard product constraints, derived from research)

| Constraint | Reason |
|---|---|
| Works 100% offline. No network calls required for any core function. | ChordieApp requires constant internet (online chord definitions + DRM); its issue tracker is full of "auto disconnect and logout" and license verification complaints. This is our #1 marketing claim. |
| One license covers Windows AND macOS. | ChordieApp charges per-OS and licenses are non-transferable. |
| Free trial / free tier exists. | ChordieApp has none; open GitHub issue requesting one. |
| One-time purchase, no subscription for core app. | Category norm (Chordio $14.99, Scaler $59.99, MidiStickers $59, Keysight ~$25). Subscription fatigue is documented in this market. |
| Lightweight: idle < ~150 MB RAM, low CPU at 60fps rendering. | The newest OBS MIDI plugin got 3 stars because it "made OBS unusable, RAM through the roof." Keysight (Unreal Engine) is heavy. Lightness is a feature. |
| Correct enharmonic spelling per key, and multiple valid names per chord. | ChordieApp's fixed spelling table (E major triad in key of C displays "E Ab B") is a known annoyance. Its multi-name output (C7#5#9 = Ab triad over C7no5) is its most-loved feature. We need both done right. |
| Display mode must be obviously superior to Chordio's split-screen views. | Chordio (Mac/iPad, $14.99) is the polished incumbent on Apple platforms. Display mode + overlay server + Windows support are our differentiators. |

### 1.4 Non-goals for v1 (do NOT build)

- No lessons, quizzes, courses, or sheet-music content packs (Chordio's territory; content licensing trap).
- No audio generation beyond a basic built-in preview synth (see 3.6). We are not an instrument.
- No audio-to-chord detection (Chordify/Chord AI territory; ML scope creep).
- No VST/AU plugin in v1 (planned v2; see Phase 6). But the engine must be portable enough to make this possible — that constraint is real now.
- No iOS/iPadOS/Android.
- No account system, no cloud sync, no telemetry beyond opt-in crash reports.
- No falling-notes "Synthesia mode" in v1 (candidate for v1.x; see Backlog).

---

## 2. Architecture

### 2.1 Stack

- **Core engine**: Rust library (`keyscene-core`). Pure, no I/O, no UI. Compiles to: (a) native lib for the desktop app, (b) WASM for the overlay page, (c) future C ABI for a JUCE plugin wrapper (v2).
- **Desktop shell**: Tauri 2.x. UI in TypeScript + a rendering layer (see 2.3). Rust backend hosts MIDI I/O, the overlay server, settings, and licensing.
- **MIDI I/O**: `midir` crate (cross-platform: WinMM/WinRT on Windows, CoreMIDI on macOS). Add a feature flag / adapter for Windows MIDI Services (multi-client, Win11 24H2+) when its SDK is practical; on older Windows, degrade gracefully (see 3.1).
- **Overlay server**: `axum` (or `tiny_http`) serving a static SPA + WebSocket event stream on `127.0.0.1:<port>`. Bound to loopback only.
- **Rendering**: HTML canvas/SVG in the webview. Notation via VexFlow (evaluate) or custom SVG renderer (see 2.3 decision).

Rationale: web-tech UI gives us themeable, beautiful rendering fast and makes the OBS overlay nearly free (the overlay page reuses the same components). The Rust core keeps the door open for the JUCE plugin without a rewrite.

### 2.2 Process/module layout

```
keyscene/
  crates/
    keyscene-core/        # analysis engine (pure Rust, no_std-friendly where possible)
    keyscene-midi/        # device enumeration, input streams, virtual-port helpers
    keyscene-server/      # localhost overlay server (axum + ws)
    keyscene-app/         # Tauri backend: wires the above, settings, licensing
  ui/
    shared/              # rendering components: Keyboard, Staff, ChordCard, PedalIndicator
    studio/              # Studio mode SPA
    overlay/             # Overlay SPA (same shared components, config via URL params)
  docs/
    engine-spec.md       # normative chord/spelling rules + test vectors (Phase 1 deliverable)
```

### 2.3 Early technical decisions the agent must make (with spikes, not opinions)

1. **Notation renderer**: Spike VexFlow vs. custom SVG for our narrow need (grand staff, live add/remove noteheads, accidentals, no beaming/rhythm in v1). Success criteria: <16ms render on chord change, clean scaling 0.5x–4x, themeable colors. Pick one, document why.
2. **Event pipeline latency**: MIDI in → analysis → UI paint must be under ~30ms perceived. Measure with a test harness before building features on top.
3. **Windows MIDI Services**: verify what `midir` sees on Win11 24H2/25H2 with WMS enabled vs. Win10. Document the compatibility matrix.

---

## 3. Functional specification

### 3.1 MIDI input layer (`keyscene-midi`)

- Enumerate all input devices; hot-plug detection; remember last-used device.
- Listen on **all channels by default** with per-channel filtering available (ChordieApp only reads channel 1 — a documented limitation; we must not repeat it).
- Handle: NoteOn/NoteOff (incl. NoteOn vel=0), sustain (CC64), soft (CC67), sostenuto (CC66). Sustained notes tracked separately from held notes; analysis can include or exclude sustained notes (user toggle).
- QWERTY fallback keyboard so the app works with zero hardware (trial experience).
- MIDI file playback: load a .mid, play it through the same pipeline as live input (analysis works identically). Transport: play/pause/seek/loop/tempo scale.
- Windows without multi-client MIDI (Win10, or Win11 pre-rollout): detect when a device open fails because the DAW holds it; show a targeted help panel (not a generic error) explaining options, including loopMIDI setup, with copy-paste instructions. On Win11 with Windows MIDI Services active, everything just works — detect and skip the warning.

### 3.2 Analysis engine (`keyscene-core`) — the crown jewel

Input: set of currently-active pitches (MIDI numbers) + optional user-selected key/tonality + settings. Output: an `Analysis` struct. All pure functions; deterministic; fully unit-tested.

`Analysis` contains:
- `chord_names: Vec<ChordName>` — ALL valid interpretations, ranked by plausibility (root-position likelihood, key context, bass note). E.g. C-E-G-Bb-Eb-Ab yields "C7(#5#9)" and "Ab triad / C7(no5)" style alternates. Ranking heuristics documented in `docs/engine-spec.md`.
- `spelled_notes: Vec<SpelledNote>` — enharmonic spelling derived from (a) selected key signature, (b) chord interpretation (a C#dim7 spells Bb as A#, etc.), (c) melodic context when available. NEVER a fixed per-key lookup table. Rule set + ≥200 test vectors in `engine-spec.md`.
- `roman_numeral: Option<RomanNumeral>` — when a key is selected: degree, quality, inversion figures, secondary-dominant notation (V7/V), borrowed-chord marking. Support at least two display conventions (modern textbook: I, iii, V7; alternate: I, IIIm, V7) as a user setting. (MidiStickers ships four conventions; two is our floor.)
- `intervals`, `bass_note`, `inversion`, `is_partial` (2-note dyads get interval names, single notes get note names — never blank output).
- Key detection (assistive, not automatic-only): suggest likely keys from recent input; user confirms. Manual key selection always available, including major/minor mode choice (open ChordieApp issue #83 requests exactly this).

Chord vocabulary: triads (maj/min/dim/aug/sus2/sus4), 6ths, all 7ths, extended (9/11/13 with alterations), add chords, slash chords, quartal stacks, common polychords. Definitions live in data files (RON/JSON) inside the binary — NOT fetched from a server. Target: meets or exceeds ChordieApp's vocabulary. Build a comparison test list from its marketing claims ("even got the tritones").

### 3.3 Studio mode UI

- Three synced views: ChordCard (big current-chord readout + alternate names), Grand Staff, Keyboard (49/61/76/88-key options, resizable). Layout: user can show/hide/resize each.
- Key selector (key + major/minor) in toolbar; Roman numerals appear when set.
- **Reverse lookup**: searchable chord browser — pick root + quality → keys light up on the keyboard + staff shows it; click-to-audition with preview synth. (Top feature request in ChordieApp's KVR thread.)
- **Progression capture**: rolling history of detected chords; user pins chords into a progression lane; reorder; export as .mid (one chord per bar, sensible voicings preserved from what was played); drag-out to DAW where OS allows.
- Settings: note-name language (English C-D-E, German C-D-E-F-G-A-H, solfège Do-Re-Mi — open ChordieApp issue #71 requests German), accidental preference override, sustained-note inclusion, MIDI device/channels, theme.

### 3.4 Display mode

- Toggle from Studio mode (single click / hotkey). Removes all chrome. Borderless, always-on-top optional, click-through optional.
- Each element (ChordCard, Staff, Keyboard, Pedal indicator, Key/RN readout) independently: visible/hidden, positioned, scaled. Layouts saveable as presets ("Lesson", "Stream", "Tutorial recording").
- Backgrounds: any solid color (for chroma key), or transparent window where the OS supports it.
- Themes: ship 6–8 polished presets (dark/light/neon/minimal/classic/high-contrast) + full custom colors and font choice. Theme applies to both Studio and Display and the overlay.
- Anti-flicker: chord display uses a debounce/hold strategy — configurable hold time so names don't flicker during arpeggiation or between chord changes. This detail is what separates "demo" from "usable on stream". Make it a first-class, well-tuned setting.

### 3.5 Overlay server (the killer feature)

- Runs inside the desktop app (opt-in toggle: "Enable OBS overlay"). Serves `http://127.0.0.1:<port>/overlay` — a page with transparent background rendering the same elements, configured by URL params and/or a config UI that generates the URL.
- Live data over WebSocket from the app. Reconnect automatically.
- The page is what users add as an OBS Browser Source. Document the 3-step setup in-app with copyable URL.
- Multiple simultaneous overlay pages with different configs must work (e.g., chord name in one corner, keyboard at the bottom, as two browser sources).
- Loopback-only binding; no auth needed in v1 (localhost), but design so a token can be added later.

### 3.6 Preview synth

Minimal built-in sound (simple piano/EP sample or basic synth) ONLY for: reverse-lookup audition, MIDI file playback, and QWERTY input. Off by default when a MIDI device is active (users have DAWs/keyboards; ChordieApp's "no audio" stance is fine for live input). Do not invest in sound quality beyond "pleasant".

### 3.7 Licensing & trial

- Offline license key validation (ed25519-signed keys; machine-independent — the key just validates, no activation server required for core function). Optional online activation check may gate updates, never runtime.
- Trial: full-featured, watermark on Display mode + overlay ("Made with Keyscene") and progression export capped at 4 chords. No time bomb.
- One key unlocks Windows + macOS.
- Payment/fulfillment platform TBD (Gumroad/Paddle/LemonSqueezy) — decouple: the app validates keys, the store issues them.

---

## 4. Build order (phases with acceptance criteria)

Work strictly in phase order. Each phase ends with its acceptance criteria demonstrably met (automated tests where stated, manual checklist otherwise) before the next begins.

### Phase 0 — Spikes & scaffolding (1–2 weeks equivalent)
- Repo scaffold per §2.2; CI building Win + macOS artifacts from day one.
- Spike A: `midir` input → console log on both OSes; measure input latency.
- Spike B: notation renderer bake-off (VexFlow vs custom SVG) against §2.3 criteria; write ADR.
- Spike C: Tauri transparent/borderless/always-on-top/click-through window on both OSes; document OS quirks.
- Spike D: axum WebSocket page updating at 60Hz from a Rust tick loop.
- **Accept**: ADRs written for renderer + Windows MIDI matrix; hello-world app shows a live-updating overlay page.

### Phase 1 — Engine (the moat)
- Implement `keyscene-core` per §3.2. Write `docs/engine-spec.md` FIRST: normative rules + test vectors (≥200 spelling cases, ≥300 chord-naming cases incl. inversions, slash, altered, polychords; ≥100 Roman-numeral cases incl. secondary dominants and borrowed chords).
- Property tests: naming is stable under octave transposition; spelling respects key signature; every 3+ note input produces at least one name or a defined "cluster" fallback.
- **Accept**: all vectors green; fuzz run (random note sets) produces no panics and no empty output; WASM build of core passes the same test suite.

### Phase 2 — Studio mode MVP
- MIDI layer per §3.1 (live input only; file playback deferred to Phase 4). ChordCard + Staff + Keyboard synced views. Key selector + Roman numerals. Settings persistence.
- **Accept**: manual script — play 20 predefined chords on hardware on both OSes; correct names/spellings/RNs render in <50ms perceived; app survives device unplug/replug; QWERTY input works with no hardware.

### Phase 3 — Display mode + themes
- Mode toggle, element show/hide/position/scale, layout presets, chroma/transparent backgrounds, 6–8 themes, chord-hold anti-flicker tuning.
- **Accept**: OBS window-capture test on both OSes produces clean keyable output; a non-developer can build a stream layout in under 5 minutes following in-app guidance; RAM under target from §1.3 while rendering at 60fps.

### Phase 4 — Overlay server + MIDI file playback
- §3.5 in full; §3.1 MIDI file transport; overlay setup wizard with copyable URLs.
- **Accept**: OBS Browser Source shows transparent overlay tracking live playing; two simultaneous differently-configured sources work; overlay reconnects after app restart without touching OBS; MIDI file plays through the full analysis pipeline.

### Phase 5 — Reverse lookup, progressions, polish, licensing
- §3.3 reverse lookup + progression capture/export; preview synth; §3.7 licensing + trial watermark; onboarding (first-run device setup, sample MIDI file demo); crash reporting (opt-in); installers signed + notarized.
- **Accept**: end-to-end trial→purchase→unlock flow works offline after key delivery; export .mid opens correctly in Ableton/Logic/FL/Reaper; installers pass Gatekeeper/SmartScreen.

### Phase 6 (v2, do not start) — JUCE VST3/AU wrapper around `keyscene-core` C ABI; falling-notes view; guitar fretboard view (name-only, we can't know strings); Spout2/Syphon output; localization beyond note names.

---

## 5. Backlog (validated demand, not v1)

Each item traces to a research signal — keep these attributions:
- Falling-notes practice view (Synthesia stagnant since 2022; its users are orphaned).
- Scale-degree display of current chord within selected scale (KVR request on Chordie thread).
- Compact "chord name only" micro-widget (jamosapien forum request: small text, minimal footprint).
- Per-element overlay as separate URLs → already covered by §3.5 multi-source; extend with per-source themes.
- Kids/beginner display options (Ultimate Piano ships animal icons; teachers of children are an audience).
- Figured bass / additional RN conventions (MidiStickers territory — only if teachers ask).

## 6. Engineering ground rules

- Engine changes require test vectors in the same PR. The engine spec doc is normative; disputes resolve by updating the spec first.
- No network calls anywhere except: opt-in update check, opt-in crash reports. CI includes a test asserting the binary makes zero connections in default config.
- Performance budgets are CI-enforced where possible (bundle size, idle RAM smoke test).
- Every user-facing error must say what to DO next (the Windows MIDI help panel in §3.1 is the model).
- Accessibility: keyboard navigation in Studio mode; high-contrast theme; respects OS reduced-motion.

## 7. Competitive reference sheet (for agent context)

| Product | Price | Platforms | Strength | Weakness we exploit |
|---|---|---|---|---|
| ChordieApp | $25/OS | Win, Mac | Deep multi-name chords; YouTube educator base | Online-only DRM, stale, ch.1 only, fixed spelling table, no trial |
| Chordio | $14.99 + IAPs | Mac, iPad, visionOS | Polished 6-workspace suite, Harmony Explorer | No Windows, no OBS story, IAP pop-up complaints |
| MidiStickers Pro | $59 | Win, Mac (AS only) | Academic depth (RN conventions, figured bass), floating widgets | Dense/academic, no browser-source overlay, priced high |
| Keysight | ~$25 | Win (Steam) | Gorgeous particles for streamers | Zero theory, heavy (Unreal), Windows only |
| The Ultimate Piano | $4–6/mo | Browser | Browser-source convenience, pedal display | 19 chord types only, subscription, compat hedging |
| Scaler 3 | $59.99 | Win, Mac (plugin+standalone) | Category leader for generation; detection panel | Not a display tool; no overlay/teaching use |
| Synthesia | one-time | Win, Mac, mobile | Brand recognition | Desktop dormant since 2022 |

Positioning line: "Keyscene — see your harmony. Offline, cross-platform, and built for the camera. Your keys, scene-ready."
