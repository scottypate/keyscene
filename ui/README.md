# ui

Scaffolded in Phase 0 Spike B/C once the notation-renderer ADR picks the
rendering approach (VexFlow vs. custom SVG).

- `shared/` — rendering components used by both SPAs: Keyboard, Staff,
  ChordCard, PedalIndicator. Theme system lives here.
- `studio/` — Studio mode SPA (interactive windowed app).
- `overlay/` — Overlay SPA for OBS browser sources; same shared components,
  configured via URL params.
