# Keyscene

Theory-aware MIDI chord visualizer for Windows and macOS. See your harmony —
offline, cross-platform, and built for the camera.

The normative project plan lives in [`../PLAN.md`](../PLAN.md) (repo parent).
Read it fully before working on any phase; do not expand scope beyond it.

## Layout

```tree
crates/
  keyscene-core/    # analysis engine (pure Rust, no I/O)
  keyscene-midi/    # device enumeration, input streams
  keyscene-server/  # localhost overlay server (axum + ws)
  keyscene-app/     # desktop shell backend (Tauri 2.x)
ui/
  shared/           # rendering components (Keyboard, Staff, ChordCard, ...)
  studio/           # Studio mode SPA
  overlay/          # OBS overlay SPA
docs/
  engine-spec.md    # normative chord/spelling rules + test vectors (Phase 1)
```

## Build

```sh
cargo build --workspace
cargo test --workspace
cargo run -p keyscene-app   # lists MIDI input devices
```

## Phase 0 spikes

Results and quirks: [`docs/spike-notes.md`](docs/spike-notes.md).

```sh
cargo run -p keyscene-midi --bin spike_a_latency loopback   # MIDI stack latency
cargo run -p keyscene-server --bin spike_d_ws               # 60Hz overlay → http://127.0.0.1:43117/
(cd spikes/tauri-window && cargo run)                       # Display-mode window probe
(cd ui/spikes/renderer-bakeoff && cat README.md)            # notation renderer bench
```
