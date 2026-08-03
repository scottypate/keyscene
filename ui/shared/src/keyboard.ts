// On-screen keyboard (SVG). Sizes per PLAN.md §3.3: 49/61/76/88 keys.
// Full redraw on size/theme change; note updates only touch fills.

import type { KeyboardSize } from "./types";
import type { Theme } from "./theme";

const SVG_NS = "http://www.w3.org/2000/svg";

/** midi range (inclusive) per keyboard size, standard layouts. */
const RANGES: Record<KeyboardSize, [number, number]> = {
  49: [36, 84], // C2–C6
  61: [36, 96], // C2–C7
  76: [28, 103], // E1–G7
  88: [21, 108], // A0–C8
};

const BLACK_PCS = new Set([1, 3, 6, 8, 10]);
/** Horizontal offset of a black key within its octave, in white-key units. */
const BLACK_OFFSET: Record<number, number> = {
  1: 0.62, // C#
  3: 1.78, // D#
  6: 3.58, // F#
  8: 4.7, // G#
  10: 5.82, // A#
};
/** White-key index within an octave for each natural pc. */
const WHITE_INDEX: Record<number, number> = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };

const WHITE_W = 24;
const WHITE_H = 120;
const BLACK_W = 15;
const BLACK_H = 76;

export class Keyboard {
  private container: HTMLElement;
  private theme: Theme;
  private size: KeyboardSize = 61;
  private keyEls = new Map<number, SVGRectElement>();
  private held = new Set<number>();
  private sustained = new Set<number>();

  constructor(container: HTMLElement, theme: Theme) {
    this.container = container;
    this.theme = theme;
    this.rebuild();
  }

  setSize(size: KeyboardSize): void {
    if (size === this.size) return;
    this.size = size;
    this.rebuild();
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.rebuild();
  }

  setNotes(held: number[], sustained: number[]): void {
    const nextHeld = new Set(held);
    const nextSust = new Set(sustained);
    for (const midi of this.keyEls.keys()) {
      const was = this.held.has(midi) ? 2 : this.sustained.has(midi) ? 1 : 0;
      const now = nextHeld.has(midi) ? 2 : nextSust.has(midi) ? 1 : 0;
      if (was !== now) this.paintKey(midi, now);
    }
    this.held = nextHeld;
    this.sustained = nextSust;
  }

  private paintKey(midi: number, state: 0 | 1 | 2): void {
    const el = this.keyEls.get(midi);
    if (!el) return;
    const black = BLACK_PCS.has(midi % 12);
    const base = black ? this.theme.keyBlack : this.theme.keyWhite;
    el.setAttribute(
      "fill",
      state === 2 ? this.theme.accent : state === 1 ? this.theme.sustain : base,
    );
  }

  private rebuild(): void {
    const [lo, hi] = RANGES[this.size];
    this.keyEls.clear();
    const svg = document.createElementNS(SVG_NS, "svg");

    // X of a white key in white-key units from the range start.
    const whiteUnits = (midi: number): number => {
      const oct = Math.floor(midi / 12);
      return oct * 7 + WHITE_INDEX[midi % 12];
    };
    const originUnits = whiteUnits(lo); // lo is always a white key in RANGES
    const totalWhites =
      whiteUnits(hi) - originUnits + (BLACK_PCS.has(hi % 12) ? 0 : 1);
    const width = totalWhites * WHITE_W;

    svg.setAttribute("viewBox", `0 0 ${width} ${WHITE_H}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.display = "block";

    const whites: SVGRectElement[] = [];
    const blacks: SVGRectElement[] = [];
    for (let midi = lo; midi <= hi; midi++) {
      const pc = midi % 12;
      const rect = document.createElementNS(SVG_NS, "rect");
      if (BLACK_PCS.has(pc)) {
        const oct = Math.floor(midi / 12);
        const x = (oct * 7 + BLACK_OFFSET[pc] - originUnits) * WHITE_W;
        rect.setAttribute("x", String(x));
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(BLACK_W));
        rect.setAttribute("height", String(BLACK_H));
        rect.setAttribute("fill", this.theme.keyBlack);
        rect.setAttribute("stroke", this.theme.keyEdge);
        rect.setAttribute("rx", "2");
        blacks.push(rect);
      } else {
        const x = (whiteUnits(midi) - originUnits) * WHITE_W;
        rect.setAttribute("x", String(x));
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(WHITE_W));
        rect.setAttribute("height", String(WHITE_H));
        rect.setAttribute("fill", this.theme.keyWhite);
        rect.setAttribute("stroke", this.theme.keyEdge);
        rect.setAttribute("rx", "2");
        whites.push(rect);
      }
      rect.dataset.midi = String(midi);
      this.keyEls.set(midi, rect);
    }
    // Whites under blacks.
    for (const r of whites) svg.appendChild(r);
    for (const r of blacks) svg.appendChild(r);

    this.container.replaceChildren(svg);
    // Re-apply current highlight state onto the fresh elements.
    for (const midi of this.held) this.paintKey(midi, 2);
    for (const midi of this.sustained) if (!this.held.has(midi)) this.paintKey(midi, 1);
  }
}
