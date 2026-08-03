// Chord-hold anti-flicker (PLAN.md §3.4): during arpeggiation, richer
// readings must not be replaced by transient weaker ones until they have
// persisted for the hold time. The hold only ever applies to dropouts —
// weaker readings whose notes are a subset of what's on screen. Upgrades,
// readings containing any new note (a chord change), and readings arriving
// on a sustain/sostenuto lift (a deliberate gesture revealing the real
// chord) all render immediately, so live playing feels instant.

import type { Analysis, Pedals } from "./types";

export class AnalysisHold {
  private holdMs = 0;
  private strength = 0;
  /** MIDI notes of the reading currently on screen. */
  private shown = new Set<number>();
  private pedalDown = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Analysis | null = null;

  constructor(private render: (analysis: Analysis | null) => void) {}

  setHoldMs(ms: number): void {
    this.holdMs = Math.max(0, ms);
  }

  push(analysis: Analysis | null, pedals?: Pedals): void {
    const down = pedals ? pedals.sustain || pedals.sostenuto : this.pedalDown;
    const lifted = this.pedalDown && !down;
    this.pedalDown = down;

    const notes = analysis?.spelledNotes.map((n) => n.midi) ?? [];
    const dropout = notes.every((m) => this.shown.has(m));
    if (
      this.holdMs === 0 ||
      lifted ||
      notes.length >= this.strength ||
      !dropout
    ) {
      this.commit(analysis, notes.length);
      return;
    }
    // Dropout: keep showing the current reading, swap after holdMs.
    this.pending = analysis;
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        const p = this.pending;
        this.commit(p, p?.spelledNotes.length ?? 0);
      }, this.holdMs);
    }
  }

  private commit(analysis: Analysis | null, strength: number): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
    this.strength = strength;
    this.shown = new Set(analysis?.spelledNotes.map((n) => n.midi));
    this.render(analysis);
  }
}
