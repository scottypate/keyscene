// On-screen keyboard (SVG). Sizes per PLAN.md §3.3: 49/61/76/88 keys.
// Full redraw on size/theme change; note updates only touch fills.

import type { KeyboardSize, SpelledNote } from "./types";
import type { Theme } from "./theme";

const ACC_GLYPH = ["♭♭", "♭", "", "♯", "♯♯"];
/** Fallback names for sounding notes the analysis didn't spell
 *  (e.g. sustained notes excluded from analysis by the user toggle). */
const PC_FALLBACK = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

function spelledLabel(n: SpelledNote): string {
  return n.letter + (ACC_GLYPH[n.acc + 2] ?? "");
}

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
/** Headroom above the keys where sounding-note names float. Two rows: the
 *  lower row (nearest the keys) is the default; a label that would collide
 *  with its left neighbor staggers up to the second row. */
const LABEL_BAND = 50;
const LABEL_SIZE = 21;
const LABEL_ROW_Y = [LABEL_BAND - 5, LABEL_BAND - 28]; // baselines: lower, upper
const LABEL_GAP = 3;

export class Keyboard {
  private container: HTMLElement;
  private theme: Theme;
  private size: KeyboardSize = 61;
  private keyEls = new Map<number, SVGRectElement>();
  private held = new Set<number>();
  private sustained = new Set<number>();
  /** midi → spelled name of the sounding note, from the analysis. */
  private spelled = new Map<number, string>();
  private labelLayer: SVGGElement | null = null;

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

  setNotes(held: number[], sustained: number[], spelled?: SpelledNote[]): void {
    const nextHeld = new Set(held);
    const nextSust = new Set(sustained);
    for (const midi of this.keyEls.keys()) {
      const was = this.held.has(midi) ? 2 : this.sustained.has(midi) ? 1 : 0;
      const now = nextHeld.has(midi) ? 2 : nextSust.has(midi) ? 1 : 0;
      if (was !== now) this.paintKey(midi, now);
    }
    this.held = nextHeld;
    this.sustained = nextSust;
    if (spelled) {
      this.spelled = new Map(spelled.map((n) => [n.midi, spelledLabel(n)]));
    }
    this.renderLabels();
  }

  /** Name every sounding key, spelled like the chord (G♭ vs F♯), floating
   *  above the keys; color ties each name to its lit key. Labels stagger
   *  onto a second row when neighbors would collide (dense clusters). */
  private renderLabels(): void {
    if (!this.labelLayer) return;
    this.labelLayer.replaceChildren();
    const sounding = [...new Set([...this.held, ...this.sustained])].sort((a, b) => a - b);
    // Rightmost extent already occupied on each row.
    const rowEnd = [-Infinity, -Infinity];
    for (const midi of sounding) {
      const key = this.keyEls.get(midi);
      if (!key) continue;
      const black = BLACK_PCS.has(midi % 12);
      const text = this.spelled.get(midi) ?? PC_FALLBACK[midi % 12];
      const cx = Number(key.getAttribute("x")) + (black ? BLACK_W : WHITE_W) / 2;
      // Approximate width: one letter plus accidental glyphs.
      const w = LABEL_SIZE * (0.62 + 0.42 * (text.length - 1));
      const x0 = cx - w / 2;
      const fits = (r: number): boolean => x0 >= rowEnd[r] + LABEL_GAP;
      const row = fits(0) ? 0 : fits(1) ? 1 : rowEnd[0] <= rowEnd[1] ? 0 : 1;
      rowEnd[row] = cx + w / 2;

      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", String(cx));
      label.setAttribute("y", String(LABEL_ROW_Y[row]));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("font-size", String(LABEL_SIZE));
      label.setAttribute("font-weight", "650");
      label.setAttribute(
        "fill",
        this.held.has(midi) ? this.theme.accent : this.theme.sustain,
      );
      label.setAttribute("pointer-events", "none");
      label.textContent = text;
      this.labelLayer.appendChild(label);
    }
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
    // A hand-edited settings.json can carry any u8 — never throw on it.
    const [lo, hi] = RANGES[this.size] ?? RANGES[88];
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

    svg.setAttribute("viewBox", `0 0 ${width} ${WHITE_H + LABEL_BAND}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.display = "block";

    const whites: SVGRectElement[] = [];
    const blacks: SVGRectElement[] = [];
    const bevels: SVGRectElement[] = [];
    for (let midi = lo; midi <= hi; midi++) {
      const pc = midi % 12;
      const rect = document.createElementNS(SVG_NS, "rect");
      if (BLACK_PCS.has(pc)) {
        const oct = Math.floor(midi / 12);
        const x = (oct * 7 + BLACK_OFFSET[pc] - originUnits) * WHITE_W;
        rect.setAttribute("x", String(x));
        rect.setAttribute("y", String(LABEL_BAND));
        rect.setAttribute("width", String(BLACK_W));
        rect.setAttribute("height", String(BLACK_H));
        rect.setAttribute("fill", this.theme.keyBlack);
        rect.setAttribute("stroke", this.theme.keyEdge);
        rect.setAttribute("rx", "2");
        blacks.push(rect);
        // Front-face bevel: the lit "step" at the bottom of a black key.
        const bevel = document.createElementNS(SVG_NS, "rect");
        bevel.setAttribute("x", String(x + 1.6));
        bevel.setAttribute("y", String(LABEL_BAND + BLACK_H - 13));
        bevel.setAttribute("width", String(BLACK_W - 3.2));
        bevel.setAttribute("height", "9");
        bevel.setAttribute("rx", "1.6");
        bevel.setAttribute("fill", "#fff");
        bevel.setAttribute("opacity", "0.14");
        bevel.setAttribute("pointer-events", "none");
        bevels.push(bevel);
      } else {
        const x = (whiteUnits(midi) - originUnits) * WHITE_W;
        rect.setAttribute("x", String(x));
        rect.setAttribute("y", String(LABEL_BAND));
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
    // Layering: whites under blacks, bevel highlights on top.
    for (const r of whites) svg.appendChild(r);
    for (const r of blacks) svg.appendChild(r);
    for (const r of bevels) svg.appendChild(r);

    // Octave labels on the C keys (C4 = middle C, MIDI 60).
    for (let midi = lo; midi <= hi; midi++) {
      if (midi % 12 !== 0) continue;
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute(
        "x",
        String((whiteUnits(midi) - originUnits) * WHITE_W + WHITE_W / 2),
      );
      label.setAttribute("y", String(LABEL_BAND + WHITE_H - 6));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("font-size", "8");
      label.setAttribute("fill", this.theme.muted);
      label.setAttribute("pointer-events", "none");
      label.textContent = `C${Math.floor(midi / 12) - 1}`;
      svg.appendChild(label);
    }

    // Sounding-note labels draw above everything.
    this.labelLayer = document.createElementNS(SVG_NS, "g");
    svg.appendChild(this.labelLayer);

    this.container.replaceChildren(svg);
    // Re-apply current highlight state onto the fresh elements.
    for (const midi of this.held) this.paintKey(midi, 2);
    for (const midi of this.sustained) if (!this.held.has(midi)) this.paintKey(midi, 1);
    this.renderLabels();
  }
}
