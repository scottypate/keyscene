// Theme tokens. Phase 2 ships one polished dark theme; the full 6–8 theme
// system arrives in Phase 3 (PLAN.md §3.4). Components read colors from
// here (not CSS) because VexFlow bakes colors at draw time (ADR-001).

export interface Theme {
  /** App background */
  bg: string;
  /** Panel background */
  panel: string;
  /** Primary ink (staff lines, note heads, text) */
  ink: string;
  /** Secondary/dimmed text */
  muted: string;
  /** Accent: held notes, primary chord name */
  accent: string;
  /** Sustained (pedal-held) notes */
  sustain: string;
  /** Keyboard white key */
  keyWhite: string;
  /** Keyboard black key */
  keyBlack: string;
  /** Keyboard outline */
  keyEdge: string;
}

export const darkTheme: Theme = {
  bg: "#101014",
  panel: "#18181f",
  ink: "#e8e8ee",
  muted: "#8b8b98",
  accent: "#4cc2ff",
  sustain: "#2a7099",
  keyWhite: "#e8e8ee",
  keyBlack: "#26262e",
  keyEdge: "#101014",
};

/** Push theme tokens onto :root as CSS custom properties for layout CSS. */
export function applyThemeCss(theme: Theme, root: HTMLElement = document.documentElement): void {
  const entries: [string, string][] = [
    ["--ks-bg", theme.bg],
    ["--ks-panel", theme.panel],
    ["--ks-ink", theme.ink],
    ["--ks-muted", theme.muted],
    ["--ks-accent", theme.accent],
    ["--ks-sustain", theme.sustain],
    ["--ks-key-white", theme.keyWhite],
    ["--ks-key-black", theme.keyBlack],
    ["--ks-key-edge", theme.keyEdge],
  ];
  for (const [k, v] of entries) root.style.setProperty(k, v);
}
