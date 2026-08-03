// Built-in Display-mode layout presets (§3.4: "Lesson", "Stream",
// "Tutorial recording"). Coordinates are percent of the window at a
// 1280×720 reference; user-saved presets live in settings, not here.

import type { DisplayElements, ElementLayout, LayoutPreset } from "@keyscene/shared";

function el(visible: boolean, x: number, y: number, scale = 1): ElementLayout {
  return { visible, x, y, scale };
}

/** Must mirror DisplayElements::default() in crates/keyscene-app/src/state.rs. */
export function defaultDisplayElements(): DisplayElements {
  return {
    chordCard: el(true, 31, 8),
    staff: el(true, 34, 32),
    keyboard: el(true, 11, 64),
    pedals: el(true, 45, 92),
    keyReadout: el(true, 4, 8),
  };
}

export const BUILT_IN_PRESETS: LayoutPreset[] = [
  {
    name: "Default",
    background: "transparent",
    elements: defaultDisplayElements(),
  },
  {
    // Stream: big keyboard along the bottom, chord name upper-right,
    // everything else out of the way. Transparent for OBS alpha.
    name: "Stream",
    background: "transparent",
    elements: {
      chordCard: el(true, 60, 4),
      staff: el(false, 34, 12),
      keyboard: el(true, 4, 68, 1.5),
      pedals: el(true, 2, 92),
      keyReadout: el(false, 4, 4),
    },
  },
  {
    // Lesson: staff front and center for teaching, key context visible.
    // Solid dark background for projectors / Zoom shares.
    name: "Lesson",
    background: "#101014",
    elements: {
      chordCard: el(true, 56, 22),
      staff: el(true, 8, 14, 1.3),
      keyboard: el(true, 11, 66),
      pedals: el(true, 45, 93),
      keyReadout: el(true, 4, 4),
    },
  },
  {
    // Tutorial recording: chroma-green background, all context on screen.
    name: "Tutorial recording",
    background: "#00b140",
    elements: {
      chordCard: el(true, 4, 6, 1.1),
      staff: el(true, 64, 6, 0.9),
      keyboard: el(true, 13, 60, 1.2),
      pedals: el(true, 4, 92),
      keyReadout: el(true, 4, 34),
    },
  },
];
