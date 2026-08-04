// Treble/bass split contract: adjacent keys must never straddle the staff
// gap (B3+C4 render together), while two-hand voicings still split near
// middle C.

import { describe, expect, it } from "vitest";
import { splitIndex } from "./staff";
import type { SpelledNote } from "./types";

const LETTERS = ["C", "C", "D", "E", "E", "F", "F", "G", "A", "A", "B", "B"];
const ACCS = [0, 1, 0, -1, 0, 0, 1, 0, -1, 0, -1, 0];

/** SpelledNote from midi, sharp-ish default spelling (enough for the split). */
function note(midi: number): SpelledNote {
  const pc = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  const letter = LETTERS[pc];
  const acc = ACCS[pc];
  return { letter, acc, octave, midi, text: `${letter}${octave}` };
}

function split(midis: number[]): { bass: number[]; treble: number[] } {
  const notes = midis.map(note);
  const i = splitIndex(notes);
  return { bass: midis.slice(0, i), treble: midis.slice(i) };
}

describe("splitIndex", () => {
  it("keeps B3+C4 on one staff", () => {
    const { bass, treble } = split([59, 60]);
    expect(bass.length === 0 || treble.length === 0).toBe(true);
  });

  it("puts a lone middle C on the treble staff", () => {
    expect(split([60])).toEqual({ bass: [], treble: [60] });
  });

  it("puts a lone B3 on the bass staff", () => {
    expect(split([59])).toEqual({ bass: [59], treble: [] });
  });

  it("keeps a right-hand triad on the treble staff", () => {
    expect(split([60, 64, 67]).bass).toEqual([]);
  });

  it("keeps a left-hand voicing around the break on the bass staff", () => {
    expect(split([55, 59, 62]).treble).toEqual([]);
  });

  it("splits a two-hand voicing between the hands", () => {
    expect(split([48, 52, 55, 60, 64, 67])).toEqual({
      bass: [48, 52, 55],
      treble: [60, 64, 67],
    });
  });

  it("keeps a low cluster off the treble staff entirely", () => {
    expect(split([41, 44, 48]).treble).toEqual([]);
  });
});
