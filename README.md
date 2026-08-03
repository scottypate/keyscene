# Keyscene

Theory-aware MIDI chord visualizer for Windows and macOS. See your harmony —
offline, cross-platform, and built for the camera.

The normative project plan lives in [`PLAN.md`](PLAN.md).
Read it fully before working on any phase; do not expand scope beyond it.

## Layout

```tree
crates/
  keyscene-core/    # analysis engine (pure Rust, no I/O)
  keyscene-midi/    # device enumeration, input streams
  keyscene-server/  # localhost overlay server (Phase 4 stub)
  keyscene-app/     # desktop shell backend (Tauri 2.x)
ui/
  shared/           # rendering components (Keyboard, Staff, ChordCard, ...)
  studio/           # Studio + Display mode SPA (index.html / display.html)
  overlay/          # OBS overlay SPA (Phase 4, empty)
docs/
  engine-spec.md    # normative chord/spelling rules + test vectors (Phase 1)
```

## Build

The UI must be built first: `tauri::generate_context!` embeds
`ui/studio/dist` into the app binary at compile time.

```sh
cd ui && npm ci && npm run check && npm run build && cd ..
cargo build --workspace
cargo test --workspace
```

## Run (development)

```sh
cd ui && npm run dev &          # vite on :1420 (tauri.conf devUrl)
cd crates/keyscene-app && cargo tauri dev
```

## Bundle (production)

```sh
cd crates/keyscene-app && cargo tauri build   # runs the UI build first
```

Produces `.app`/`.dmg` on macOS and `.msi`/NSIS on Windows under
`target/release/bundle/`. Unsigned builds trip Gatekeeper/SmartScreen —
see the signing keys in `tauri.conf.json` before distributing.

## Phase 0 spikes

Results and quirks: [`docs/spike-notes.md`](docs/spike-notes.md).
Surviving spike binaries:

```sh
cargo run -p keyscene-midi --bin spike_a_latency loopback   # MIDI stack latency
cargo run -p keyscene-server --bin spike_d_ws               # 60Hz overlay → http://127.0.0.1:43117/
```

## License

MIT — see [`LICENSE`](LICENSE).
