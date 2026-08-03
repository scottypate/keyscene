// AnalysisHold contract (PLAN.md §3.4 + the subset/pedal-lift rework):
// the anti-flicker hold delays only true dropouts — weaker readings whose
// notes are a subset of what's on screen. Everything a player would
// perceive as intentional renders immediately.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisHold } from "./hold";
import type { Analysis, Pedals } from "./types";

function chord(...midis: number[]): Analysis {
  return {
    chordNames: [{ text: midis.join("-"), kind: "chord", score: 0 }],
    spelledNotes: midis.map((midi) => ({
      letter: "C",
      acc: 0,
      octave: 4,
      midi,
      text: "C4",
    })),
    romanNumeral: null,
    intervals: [],
    bassNote: null,
    inversion: null,
    isPartial: false,
  };
}

function pedals(sustain: boolean, sostenuto = false): Pedals {
  return { sustain, sostenuto, soft: false };
}

describe("AnalysisHold", () => {
  let seen: (Analysis | null)[];
  let hold: AnalysisHold;

  beforeEach(() => {
    vi.useFakeTimers();
    seen = [];
    hold = new AnalysisHold((a) => seen.push(a));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const last = (): Analysis | null => seen[seen.length - 1];
  const name = (a: Analysis | null): string | undefined => a?.chordNames[0]?.text;

  it("renders every push immediately when holdMs is 0 (the default)", () => {
    hold.push(chord(60, 64, 67));
    hold.push(chord(60)); // subset dropout, but no hold configured
    expect(seen.length).toBe(2);
    expect(name(last())).toBe("60");
  });

  it("renders upgrades immediately", () => {
    hold.setHoldMs(250);
    hold.push(chord(60));
    hold.push(chord(60, 64));
    hold.push(chord(60, 64, 67));
    expect(seen.length).toBe(3);
    expect(name(last())).toBe("60-64-67");
  });

  it("delays a subset dropout by holdMs and commits the latest pending", () => {
    hold.setHoldMs(250);
    hold.push(chord(60, 64, 67));
    hold.push(chord(60, 64)); // dropout: keep showing the triad
    expect(seen.length).toBe(1);
    vi.advanceTimersByTime(249);
    hold.push(chord(60)); // still weaker; replaces the pending value
    expect(seen.length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(seen.length).toBe(2);
    expect(name(last())).toBe("60");
  });

  it("renders a chord change immediately even when it has fewer notes", () => {
    hold.setHoldMs(250);
    hold.push(chord(60, 64, 67, 71));
    hold.push(chord(62, 65, 69)); // new notes: not a dropout
    expect(seen.length).toBe(2);
    expect(name(last())).toBe("62-65-69");
  });

  it("commits a subset immediately on sustain-pedal lift", () => {
    hold.setHoldMs(250);
    hold.push(chord(60, 64, 67, 69), pedals(true));
    hold.push(chord(60, 64, 67), pedals(false)); // deliberate reveal
    expect(seen.length).toBe(2);
    expect(name(last())).toBe("60-64-67");
  });

  it("treats a sostenuto lift like a sustain lift", () => {
    hold.setHoldMs(250);
    hold.push(chord(60, 64, 67, 69), pedals(false, true));
    hold.push(chord(60, 64, 67), pedals(false, false));
    expect(seen.length).toBe(2);
  });

  it("remembers pedal state across pushes without pedal info", () => {
    hold.setHoldMs(250);
    hold.push(chord(60, 64, 67), pedals(true));
    hold.push(chord(60, 64)); // no pedals arg: pedal still down, no lift
    expect(seen.length).toBe(1);
  });

  it("cancels a pending dropout when an equal-or-stronger reading arrives", () => {
    hold.setHoldMs(250);
    hold.push(chord(60, 64, 67));
    hold.push(chord(60, 64)); // pending dropout
    hold.push(chord(60, 64, 67)); // recovered: commit, cancel the timer
    expect(seen.length).toBe(2);
    vi.advanceTimersByTime(1000);
    expect(seen.length).toBe(2); // the stale pending never fires
    expect(name(last())).toBe("60-64-67");
  });

  it("holds the last reading briefly on release to silence, then blanks", () => {
    hold.setHoldMs(250);
    hold.push(chord(60, 64, 67));
    hold.push(null);
    expect(seen.length).toBe(1); // name still up
    vi.advanceTimersByTime(250);
    expect(seen.length).toBe(2);
    expect(last()).toBeNull();
  });

  it("resumes instantly after a committed blank", () => {
    hold.setHoldMs(250);
    hold.push(chord(60, 64, 67));
    hold.push(null);
    vi.advanceTimersByTime(250);
    hold.push(chord(48)); // anything beats silence
    expect(name(last())).toBe("48");
  });
});
