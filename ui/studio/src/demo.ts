// Canned state for browser-only dev preview (`vite dev` + ?demo) so both
// pages can be worked on without the Tauri shell.

import type { AppSettings, StatePayload } from "@keyscene/shared";
import { defaultDisplayElements } from "./presets";

export function demoSettings(): AppSettings {
  return {
    engine: { accidentalPref: "auto", rnConvention: "textbook", nameLanguage: "english" },
    includeSustained: true,
    channelMask: 0xffff,
    keyboardSize: 88,
    lastDevice: null,
    key: "C",
    showChordCard: true,
    showStaff: true,
    showKeyboard: true,
    theme: "dark",
    customTheme: {},
    holdMs: 0,
    display: {
      background: "transparent",
      alwaysOnTop: false,
      clickThrough: false,
      elements: defaultDisplayElements(),
      presets: [],
    },
    displayHelpSeen: true,
  };
}

export function demoState(): StatePayload {
  return {
    analysis: {
      chordNames: [
        { text: "C7(#5#9)", kind: "chord", score: 90 },
        { text: "C7(#9b13)", kind: "chord", score: 80 },
      ],
      spelledNotes: [
        { letter: "C", acc: 0, octave: 3, midi: 48, text: "C3" },
        { letter: "E", acc: 0, octave: 3, midi: 52, text: "E3" },
        { letter: "G", acc: 1, octave: 3, midi: 56, text: "G#3" },
        { letter: "B", acc: -1, octave: 3, midi: 58, text: "Bb3" },
        { letter: "D", acc: 1, octave: 4, midi: 63, text: "D#4" },
      ],
      romanNumeral: "V7(#5#9)/IV",
      intervals: ["M3", "A5", "m7", "A9"],
      bassNote: { letter: "C", acc: 0, octave: 3, midi: 48, text: "C3" },
      inversion: 0,
      isPartial: false,
    },
    held: [48, 52, 56, 58, 63],
    sustained: [],
    pedals: { sustain: false, sostenuto: false, soft: false },
  };
}
