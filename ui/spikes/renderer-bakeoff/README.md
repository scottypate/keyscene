# Renderer bake-off: VexFlow 5 vs custom SVG (Keyscene Phase 0, Spike B)

Empirical comparison of VexFlow and a hand-rolled SVG renderer for Keyscene's
narrow need: a grand staff showing the currently-held chord as whole noteheads
with accidentals and ledger lines, re-rendered on every chord change. No rhythm,
beams, rests, or barlines.

## Files

- `custom-staff.js` — zero-dependency ES module grand-staff chord renderer.
- `vexflow-staff.js` — same contract implemented on VexFlow 5 (global build).
- `chords.js` — seeded, deterministic sequence of 200 realistic chord changes
  (singles, triads, 7ths, two-hand voicings, accidental-heavy clusters,
  10-note chords, ledger-line extremes) plus the showcase C#dim7 chord.
- `bench.html` / `bench.js` — browser harness. Renders the full sequence
  through both renderers at scales 0.5/1/2/4 with full teardown+redraw per
  chord, forces a layout flush (offsetHeight + getBBox) after each render,
  and publishes stats as `window.__benchResults`. Open with `?showcase` for
  the side-by-side screenshot layout instead.
- `run-bench.mjs` — spins up a local static server, runs bench.html in
  headless chromium via Playwright, prints the results JSON, and saves the
  four `screenshot-*.png` files. `--no-shots` skips screenshots.

## Re-run

```sh
npm install          # vexflow + playwright (chromium must be installed)
node run-bench.mjs   # prints JSON to stdout, screenshots to this dir
```

Or open `bench.html` through any static server rooted here (the page loads
`node_modules/vexflow/build/cjs/vexflow.js`, so plain `file://` won't work for
the module imports in some browsers; the node server in `run-bench.mjs` is the
reference setup).

## Measurement caveats

- Times cover synchronous DOM construction + forced layout (getBBox/offsetHeight),
  not GPU paint/composite, which happens off the measured path on the next frame.
- 20 unmeasured warmup renders per configuration (JIT, font shaping, caches).
- Headless chromium on macOS; a live OBS overlay shares GPU with the game/stream,
  so absolute numbers are optimistic, but the renderer comparison holds.
- Custom renderer glyphs (clefs, accidentals) come from system fonts
  (Apple Symbols fallback chain); appearance varies by platform unless a music
  font (e.g. Bravura Text) is shipped.
