// Theme tokens + the 8 preset themes (PLAN.md §3.4). Components read colors
// from here (not CSS) because VexFlow bakes colors at draw time (ADR-001).
// A theme applies to Studio, Display mode, and (Phase 4) the overlay.

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
  /** UI font stack */
  font: string;
}

const SYSTEM_FONT = '-apple-system, "Segoe UI", system-ui, sans-serif';

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
  font: SYSTEM_FONT,
};

/** Preset registry. Order is the order pickers show. */
export const THEMES: Record<string, { label: string; theme: Theme }> = {
  dark: { label: "Dark", theme: darkTheme },
  light: {
    label: "Light",
    theme: {
      bg: "#f2f2f6",
      panel: "#ffffff",
      ink: "#1b1b22",
      muted: "#71717d",
      accent: "#0a84ff",
      sustain: "#79aede",
      keyWhite: "#ffffff",
      keyBlack: "#2c2c34",
      keyEdge: "#c4c4cc",
      font: SYSTEM_FONT,
    },
  },
  neon: {
    label: "Neon",
    theme: {
      bg: "#0a0a14",
      panel: "#131322",
      ink: "#e6f8ff",
      muted: "#7a7aa0",
      accent: "#ff2d95",
      sustain: "#00e5ff",
      keyWhite: "#dfe6ff",
      keyBlack: "#1c1c30",
      keyEdge: "#0a0a14",
      font: SYSTEM_FONT,
    },
  },
  minimal: {
    label: "Minimal",
    theme: {
      bg: "#ffffff",
      panel: "transparent",
      ink: "#141414",
      muted: "#9a9a9a",
      accent: "#141414",
      sustain: "#8c8c8c",
      keyWhite: "#ffffff",
      keyBlack: "#242424",
      keyEdge: "#bdbdbd",
      font: SYSTEM_FONT,
    },
  },
  classic: {
    label: "Classic",
    theme: {
      bg: "#f4ecd8",
      panel: "#faf5e8",
      ink: "#2b2620",
      muted: "#8a7f6d",
      accent: "#8a3324",
      sustain: "#b5875f",
      keyWhite: "#fcf8ee",
      keyBlack: "#33291f",
      keyEdge: "#c9bda2",
      font: 'Georgia, "Times New Roman", serif',
    },
  },
  highContrast: {
    label: "High contrast",
    theme: {
      bg: "#000000",
      panel: "#000000",
      ink: "#ffffff",
      muted: "#d4d4d4",
      accent: "#ffe100",
      sustain: "#00d0ff",
      keyWhite: "#ffffff",
      keyBlack: "#000000",
      keyEdge: "#ffffff",
      font: SYSTEM_FONT,
    },
  },
  chalkboard: {
    label: "Chalkboard",
    theme: {
      bg: "#24352c",
      panel: "#2d4237",
      ink: "#f2f0e4",
      muted: "#a9bcae",
      accent: "#ffd166",
      sustain: "#7fc8a9",
      keyWhite: "#efeddf",
      keyBlack: "#1c2a22",
      keyEdge: "#16211a",
      font: '"Chalkboard SE", "Comic Sans MS", "Segoe Print", cursive',
    },
  },
  pastel: {
    label: "Pastel",
    theme: {
      bg: "#fdf6f0",
      panel: "#ffffff",
      ink: "#4a4458",
      muted: "#a49bb0",
      accent: "#e8739f",
      sustain: "#9fd8cb",
      keyWhite: "#fffdfb",
      keyBlack: "#5a5468",
      keyEdge: "#e3d7db",
      font: SYSTEM_FONT,
    },
  },
};

/** Font stacks offered for custom themes. */
export const FONT_CHOICES: Record<string, { label: string; stack: string }> = {
  system: { label: "System", stack: SYSTEM_FONT },
  serif: { label: "Serif", stack: 'Georgia, "Times New Roman", serif' },
  rounded: {
    label: "Rounded",
    stack: 'ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif',
  },
  mono: { label: "Mono", stack: 'ui-monospace, "Cascadia Code", Consolas, monospace' },
  hand: {
    label: "Handwritten",
    stack: '"Chalkboard SE", "Comic Sans MS", "Segoe Print", cursive',
  },
};

/**
 * Resolve the active theme from settings: a preset id, or "custom" with
 * per-token overrides on top of the dark base (unknown keys ignored).
 */
export function resolveTheme(
  themeId: string,
  customTheme: Record<string, string> | undefined,
): Theme {
  if (themeId !== "custom") return (THEMES[themeId] ?? THEMES.light).theme;
  const theme = { ...darkTheme };
  for (const key of Object.keys(theme) as (keyof Theme)[]) {
    const v = customTheme?.[key];
    if (v) theme[key] = v;
  }
  return theme;
}

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
    ["--ks-font", theme.font],
  ];
  for (const [k, v] of entries) root.style.setProperty(k, v);
}
