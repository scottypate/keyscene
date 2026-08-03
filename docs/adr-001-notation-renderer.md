# ADR-001: Notation renderer — VexFlow

- **Status**: accepted (decision by project owner, 2026-08-03)
- **Context**: PLAN.md §2.3.1. Bake-off code and raw numbers in
  `ui/spikes/renderer-bakeoff/` (re-run instructions in its README).

## Decision

Use **VexFlow 5** for all staff notation (Studio, Display, and the OBS
overlay page). The candidate custom SVG renderer is rejected.

## Evidence

Bench: 200 realistic chord changes (triads → 10-note two-hand voicings,
accidental clusters), full teardown+redraw per change with forced layout
flush, headless Chromium, scales 0.5x–4x:

| renderer | median | p95 | worst observed | bundle |
|---|---|---|---|---|
| VexFlow 5.0.0 | 0.2–0.3 ms | 0.4–0.5 ms | 2.7 ms | 1101 KB raw / 676 KB gzip (all fonts); 328 KB raw with runtime-fetched fonts |
| custom SVG (243 lines) | ~0.1 ms | ~0.1 ms | 0.3 ms | ~3 KB |

Both renderers beat the <16 ms criterion by >10x and scale crisply 0.5x–4x —
performance does not discriminate. The decision was made on **output
quality**: side-by-side renders of a C#dim7 spread voicing
(`screenshot-{vexflow,custom}-x{1,2}.png` in the spike dir) showed VexFlow's
engraving is not close to matched by the custom renderer, and the custom
path would carry permanent ownership of accidental stacking, cluster
offsetting, spacing polish, and music-font embedding just to chase it.

## Accepted costs & mitigations

1. **Bundle weight on the overlay page** (fonts dominate and don't
   tree-shake). Served from the local axum server, so load is a one-time
   localhost fetch — no offline or startup concern. If weight ever matters,
   `vexflow-core` + a single font (711 KB raw / 380 KB gzip with Bravura)
   is the fallback; do not spend time on this until it shows up in a real
   measurement.
2. **Theming is per-element, not CSS**: colors are baked at draw time via
   `setStyle({fillStyle, strokeStyle})`; `stave.setStyle` does not cascade
   to clefs (iterate `stave.getModifiers()`), ledger lines need
   `setLedgerLineStyle`. Theme changes therefore require a re-render — at
   ~0.3 ms that is free. The `ui/shared` Staff component must own a single
   theme→VexFlow-styles mapping so theming stays one call site.
3. **API gotchas** to encode once in the shared component (all hit during
   the spike): `Voice.Mode.SOFT` to avoid tick-count errors; suppress
   barlines via `setBegBarType/setEndBarType(Barline.type.NONE)`;
   pre-sort notes ascending and dedupe before building `StaveNote`s;
   accidentals are index-coupled modifiers, not note properties; empty
   staves need conditional voice handling. The spike's 108-line adapter
   (`vexflow-staff.js`) is the starting point.

## Consequences

- `ui/shared` Staff component wraps VexFlow behind our own
  `{step, octave, accidental}` note-spec interface (already the spike
  adapter's shape), so the engine stays renderer-agnostic.
- VexFlow renders glyphs as text in embedded Bravura webfonts — no
  dependence on system fonts on Windows/OBS machines (a real defect of the
  custom approach).
- The custom renderer prototype stays in the spike directory as reference
  only; it is not maintained.
