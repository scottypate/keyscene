// Wire types mirroring the Rust serde output (keyscene-core / keyscene-app).
// Keep in sync with crates/keyscene-core/src/{analyze,pitch}.rs and
// crates/keyscene-app/src/state.rs.

export interface SpelledNote {
  /** Plain letter name "A".."G" */
  letter: string;
  /** Accidental -2..=2 (bb..##) */
  acc: number;
  /** Scientific octave, spelling-aware (Cb4 has midi 59) */
  octave: number;
  midi: number;
  /** English text like "C#4" */
  text: string;
}

export type NameKind =
  | "chord"
  | "polychord"
  | "quartal"
  | "cluster"
  | "dyad"
  | "single";

export interface ChordName {
  text: string;
  kind: NameKind;
  score: number;
}

export interface Analysis {
  chordNames: ChordName[];
  spelledNotes: SpelledNote[];
  romanNumeral: string | null;
  intervals: string[];
  bassNote: SpelledNote | null;
  inversion: number | null;
  isPartial: boolean;
}

export interface Pedals {
  sustain: boolean;
  sostenuto: boolean;
  soft: boolean;
}

export interface EngineSettings {
  accidentalPref: "auto" | "sharps" | "flats";
  rnConvention: "textbook" | "quality";
  nameLanguage: "english" | "german" | "solfege";
}

export type KeyboardSize = 49 | 61 | 76 | 88;

/** One movable/scalable Display-mode element (§3.4). x/y are percent of
 * the window (top-left corner); scale multiplies the element's base size. */
export interface ElementLayout {
  visible: boolean;
  x: number;
  y: number;
  scale: number;
}

export type DisplayElementId =
  | "chordCard"
  | "staff"
  | "keyboard"
  | "pedals"
  | "keyReadout";

export type DisplayElements = Record<DisplayElementId, ElementLayout>;

/** A saved Display-mode layout (§3.4 "Layouts saveable as presets"). */
export interface LayoutPreset {
  name: string;
  /** "transparent" or a CSS color (solid = chroma-key background). */
  background: string;
  elements: DisplayElements;
}

export interface DisplaySettings {
  /** "transparent" or a CSS color for chroma keying. */
  background: string;
  alwaysOnTop: boolean;
  clickThrough: boolean;
  elements: DisplayElements;
  /** User-saved presets (built-ins live in code, not settings). */
  presets: LayoutPreset[];
}

export interface AppSettings {
  engine: EngineSettings;
  includeSustained: boolean;
  /** Bit i = listen to MIDI channel i (0-based). 0xFFFF = all. */
  channelMask: number;
  keyboardSize: KeyboardSize;
  lastDevice: string | null;
  /** Selected key name ("C", "F#m") or null for no key context. */
  key: string | null;
  showChordCard: boolean;
  showStaff: boolean;
  showKeyboard: boolean;
  /** Theme preset id from THEMES, or "custom". */
  theme: string;
  /** Token overrides used when theme === "custom" (keys of Theme). */
  customTheme: Record<string, string>;
  /** Chord-hold anti-flicker time in ms (§3.4); 0 disables. */
  holdMs: number;
  display: DisplaySettings;
  /** First-run Display-mode guidance has been dismissed. */
  displayHelpSeen: boolean;
}

export interface DeviceInfo {
  index: number;
  name: string;
}

/**
 * Note-driven state, emitted on every MIDI change ("state" event).
 * Settings travel on the separate "settings" event (an `AppSettings`
 * payload) emitted only when they change.
 */
export interface StatePayload {
  analysis: Analysis;
  held: number[];
  sustained: number[];
  pedals: Pedals;
}

export interface DevicesPayload {
  devices: DeviceInfo[];
  /** Name of the connected device, if any. */
  current: string | null;
}

export interface MidiErrorPayload {
  kind: "deviceBusy" | "notFound" | "other";
  detail: string;
  device: string;
}

/** The 24 supported keys, matching keyscene_core::KEY_NAMES order. */
export const KEY_NAMES: string[] = [
  "C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F",
  "Am", "Em", "Bm", "F#m", "C#m", "G#m", "Ebm", "Bbm", "Fm", "Cm", "Gm", "Dm",
];
