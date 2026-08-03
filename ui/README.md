# ui

npm workspace (Vite + TypeScript, no framework — PLAN.md §1.3 lightness).

- `shared/` — rendering components used by both SPAs: Keyboard (SVG),
  Staff (VexFlow 5 adapter, ADR-001 gotchas encoded there), ChordCard,
  PedalIndicator. Theme tokens live here (`theme.ts`); wire types
  mirroring the Rust serde output live in `types.ts`.
- `studio/` — Studio mode SPA (Phase 2): toolbar (device/key/settings),
  synced views, QWERTY fallback, device-busy help panel.
- `overlay/` — Overlay SPA for OBS browser sources (Phase 4); same shared
  components, configured via URL params.

Commands (run in `ui/`): `npm ci`, `npm run check` (typecheck),
`npm run build` (required before `cargo build -p keyscene-app` — Tauri
embeds `studio/dist` at compile time), `npm run dev` (Vite on :1420, used
by `tauri dev`).
