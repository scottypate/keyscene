# Phase 0 spike notes

Results from the four PLAN.md Phase 0 spikes. ADRs: [ADR-001 notation
renderer](adr-001-notation-renderer.md), [ADR-002 Windows MIDI
matrix](adr-002-windows-midi-matrix.md).

Measured environment: macOS 15 (Darwin 25.5.0), Apple Silicon, Rust 1.96,
debug builds unless noted. Windows measurements pending (see ADR-002).

## Spike A — MIDI input latency harness

Harness: `crates/keyscene-midi/src/bin/spike_a_latency.rs`.

- `list` — enumerate input ports.
- `loopback [pairs]` — creates a CoreMIDI virtual source, sends NoteOn/NoteOff
  through the OS router back into a `midir` input callback, reports the
  send→callback distribution. Unix only; on Windows use loopMIDI + `listen`.
- `listen <idx>` — event logger for real hardware (decoded messages, midir
  timestamp deltas, wall-clock inter-arrival).

macOS result (500 messages): median **0.049 ms**, p99 **0.124 ms**, max
0.129 ms, zero loss, in-order delivery. The OS+callback stack consumes ~0.4%
of the 30 ms end-to-end budget (§2.3.2); the budget effectively belongs to
analysis + IPC + paint. Full table in ADR-002.

## Spike C — Tauri window quirks (Display mode requirements)

Probe app: `spikes/tauri-window/` (standalone crate, intentionally outside the
workspace; `cargo run` inside that directory; `SPIKE_AUTOCLOSE=<secs>` for an
unattended run).

macOS findings (all calls returned Ok and behaved):

| Capability | API | macOS result |
|---|---|---|
| Transparent window | `WebviewWindowBuilder::transparent(true)` | works, **requires** the `macos-private-api` cargo feature + `"macOSPrivateApi": true` in `tauri.conf.json`; page `html, body { background: transparent }` also required |
| Borderless | `.decorations(false)` | works; runtime `set_decorations(true/false)` toggles live |
| Always-on-top | `.always_on_top(true)` / `set_always_on_top` | works, toggles live |
| Click-through | `set_ignore_cursor_events(true/false)` | works, toggles live |
| Window shadow | `.shadow(false)` / `set_shadow` | works; keep **off** for transparent windows (a shadow around a "shapeless" window looks broken and can ghost when content changes) |
| Drag without titlebar | `data-tauri-drag-region` attribute | works (needed on every element that should act as a handle, incl. children) |
| Cross-thread window calls | any `WebviewWindow` method from a plain thread | works (Tauri proxies through the event loop) |

macOS quirks recorded:

1. `macos-private-api` is a hard requirement for webview transparency — it
   uses private APIs, which is fine for direct distribution but **bars Mac App
   Store distribution**. Decision: acceptable; MAS is not in the v1 plan. If
   MAS ever matters, the fallback is a solid-color (chroma-key) background,
   which Display mode offers anyway.
2. Toggling decorations on a transparent window re-adds a standard titlebar
   and window chrome background behind the content; Display mode should treat
   transparent ⇄ decorated as a mode switch (recreate or restyle), not a
   free live toggle.
3. Tauri requires a bundle icon at compile time (`icons/icon.png`, RGBA) even
   with `"bundle": { "active": false }`.
4. Visual transparency was exercised via the probe app; automated screenshot
   capture was blocked by macOS screen-recording permission. 10-second manual
   check: `cargo run` in `spikes/tauri-window/` — the desktop must be visible
   through/around the translucent card, no opaque window slab.

Windows expectations to verify on hardware (same probe binary runs there):

- Transparency works without any private-API flag (layered windows), but
  historically has interactions with `decorations(false)` + resize handles and
  with the WebView2 composition mode; verify no white flash at startup
  (known WebView2 behavior — mitigate by creating the window hidden and
  showing after the first paint).
- `set_ignore_cursor_events` maps to `WS_EX_TRANSPARENT` — verify it stops
  hit-testing but keeps rendering.
- Always-on-top vs full-screen apps and OBS's own overlay behavior.
- OBS window-capture of a transparent Tauri window: OBS composites what the
  DWM gives it; the reliable stream path remains chroma-key or the browser
  source (Spike D) — capture of true per-pixel alpha windows is exactly what
  Phase 3's acceptance test must check on Windows.

## Spike D — 60 Hz WebSocket overlay

Server: `crates/keyscene-server/src/bin/spike_d_ws.rs` (axum 0.8 + tokio
broadcast channel; loopback-only bind reused from `keyscene_server::BIND_ADDR`).
Page: `spike_d_overlay.html` — transparent background, 88-key strip animated
from the tick stream, live stats exposed at `window.__spikeStats`.

Run: `cargo run -p keyscene-server --bin spike_d_ws` → http://127.0.0.1:43117/.

Headless Chromium measurement, **two simultaneous clients** (the two-browser-
source OBS scenario from §3.5), 3 s window after warmup, per client:

| metric | client 1 | client 2 |
|---|---|---|
| rate | 59.98 Hz | 59.98 Hz |
| mean interval | 16.671 ms | 16.671 ms |
| jitter (σ) | 0.764 ms | 0.764 ms |
| max gap | 18.5 ms | 18.4 ms |
| dropped (seq gaps) | 0 | 0 |

Design notes that should carry into the real `keyscene-server`:

- One Rust tick loop + `tokio::sync::broadcast` fans out to any number of
  sockets; per-client send loops tolerate slow clients via
  `RecvError::Lagged` → skip to live edge (a late overlay frame is worthless).
- `MissedTickBehavior::Skip` on the interval for the same reason.
- Real overlay traffic is event-driven (chord changes), far below 60 Hz; this
  spike bounds the worst case (e.g. streaming per-frame animation state) and
  it is comfortably fine.

## Spike B — notation renderer bake-off

**Decision: VexFlow 5** — see [ADR-001](adr-001-notation-renderer.md) for the
numbers, the accepted costs (bundle weight, per-element theming), and the API
gotchas the shared Staff component must encode. Bench code, adapter prototype
(`vexflow-staff.js`), and side-by-side screenshots live in
`ui/spikes/renderer-bakeoff/`. Headline: both candidates rendered a chord
change in <0.5 ms p95 (criterion was <16 ms); VexFlow won outright on
engraving quality per owner review of the renders.
