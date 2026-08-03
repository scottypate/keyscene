# docs

- `engine-spec.md` — normative chord-naming / enharmonic-spelling / Roman-numeral
  rules and test vectors. Written at the start of Phase 1, before engine code.
  Engine disputes resolve by updating the spec first (PLAN.md §6).
- `spike-notes.md` — Phase 0 spike results (MIDI latency, Tauri window quirks,
  60 Hz overlay measurements).
- `adr-001-notation-renderer.md` — VexFlow vs custom SVG decision.
- `adr-002-windows-midi-matrix.md` — MIDI backend strategy + Windows
  compatibility matrix (macOS measured; Windows verification protocol inside).
- `phase2-manual-test.md` — Phase 2 (Studio MVP) manual acceptance script:
  20-chord hardware checklist, pedals, unplug/replug, QWERTY, persistence.
  Expected values regenerate via `cargo run -p keyscene-core --example
  phase2_script`.
