// QWERTY fallback keyboard (§3.1): the app is fully usable with zero
// hardware. Piano-style two-row mapping starting on A = C, Z/X shift
// octaves, Space is the sustain pedal.

/** Key → semitone offset from the base note (C of the current octave). */
const KEYMAP: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ";": 16, "'": 17,
};

export interface QwertyHandler {
  noteOn(midi: number): void;
  noteOff(midi: number): void;
  sustain(down: boolean): void;
  octaveChanged(base: number): void;
}

function isTypingTarget(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLElement &&
    (t instanceof HTMLInputElement ||
      t instanceof HTMLSelectElement ||
      t instanceof HTMLTextAreaElement ||
      t.isContentEditable)
  );
}

export class Qwerty {
  /** MIDI note of the mapped C. C4 = 60 by default. */
  private base = 60;
  /** Physical key → sounding midi note (so octave shifts release right). */
  private down = new Map<string, number>();

  constructor(private handler: QwertyHandler) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.releaseAll);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat || isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === " " || e.code === "Space") {
      e.preventDefault();
      this.handler.sustain(true);
      return;
    }
    if (key === "z" || key === "x") {
      const next = this.base + (key === "z" ? -12 : 12);
      if (next >= 24 && next <= 84) {
        this.base = next;
        this.handler.octaveChanged(this.base);
      }
      return;
    }
    const offset = KEYMAP[key];
    if (offset === undefined || this.down.has(key)) return;
    const midi = this.base + offset;
    if (midi > 127) return;
    this.down.set(key, midi);
    this.handler.noteOn(midi);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const key = e.key.toLowerCase();
    if (key === " " || e.code === "Space") {
      this.handler.sustain(false);
      return;
    }
    const midi = this.down.get(key);
    if (midi !== undefined) {
      this.down.delete(key);
      this.handler.noteOff(midi);
    }
  };

  /** Window lost focus: avoid stuck notes. */
  private releaseAll = (): void => {
    for (const [key, midi] of this.down) {
      this.down.delete(key);
      this.handler.noteOff(midi);
    }
    this.handler.sustain(false);
  };

  get octaveBase(): number {
    return this.base;
  }
}
