// Big current-chord readout + alternate names + Roman numeral (§3.3).
// Never blank: single notes show the note name, dyads the interval —
// the engine already names those (NameKind single/dyad).

import { AnalysisHold } from "./hold";
import type { Analysis, Pedals } from "./types";

const KIND_LABEL: Record<string, string> = {
  polychord: "polychord",
  quartal: "quartal",
  cluster: "cluster",
  dyad: "interval",
  single: "note",
};

const ACC_GLYPH: Record<string, string> = {
  b: "♭",
  "#": "♯",
  bb: "♭♭",
  "##": "♯♯",
};

/** ASCII accidentals attached to note letters → ♭/♯ (C#m7 → C♯m7). */
function prettyNotes(s: string): string {
  return s.replace(/([A-G])(bb|##|b|#)/g, (_, l: string, a: string) => l + ACC_GLYPH[a]);
}

/** Accidentals inside a symbol tail: 7(b9) → 7(♭9), maj7(#11) → maj7(♯11). */
function prettyTail(s: string): string {
  return s.replace(/b(?=\d)/g, "♭").replace(/#/g, "♯");
}

/**
 * Lead-sheet typesetting for template chord names: root full-size, quality
 * tail smaller and raised, slash bass in between. Other kinds (dyads,
 * clusters, polychords…) stay plain text with pretty accidentals.
 */
function chordSpans(text: string, kind: string): (HTMLElement | string)[] {
  const root = kind === "chord" ? /^[A-G](?:bb|##|b|#)?/.exec(text) : null;
  if (!root) return [prettyNotes(text)];
  let tail = text.slice(root[0].length);
  let bass = "";
  const slash = /\/[A-G](?:bb|##|b|#)?$/.exec(tail);
  if (slash) {
    bass = slash[0];
    tail = tail.slice(0, -bass.length);
  }
  const span = (cls: string, s: string): HTMLElement => {
    const el = document.createElement("span");
    el.className = cls;
    el.textContent = s;
    return el;
  };
  const out: (HTMLElement | string)[] = [span("ks-chordname-root", prettyNotes(root[0]))];
  if (tail) out.push(span("ks-chordname-tail", prettyTail(tail)));
  if (bass) out.push(span("ks-chordname-bass", prettyNotes(bass)));
  return out;
}

export class ChordCard {
  private nameEl: HTMLDivElement;
  private rnEl: HTMLDivElement;
  private altEl: HTMLDivElement;
  private subEl: HTMLDivElement;
  private hold = new AnalysisHold((a) => this.render(a));

  constructor(container: HTMLElement) {
    container.classList.add("ks-chordcard");
    this.rnEl = document.createElement("div");
    this.rnEl.className = "ks-chordcard-rn";
    this.nameEl = document.createElement("div");
    this.nameEl.className = "ks-chordcard-name";
    this.subEl = document.createElement("div");
    this.subEl.className = "ks-chordcard-sub";
    this.altEl = document.createElement("div");
    this.altEl.className = "ks-chordcard-alts";
    container.replaceChildren(this.rnEl, this.nameEl, this.subEl, this.altEl);
    this.render(null);
  }

  /** Anti-flicker hold time (§3.4); 0 renders every change immediately. */
  setHoldMs(ms: number): void {
    this.hold.setHoldMs(ms);
  }

  update(analysis: Analysis | null, pedals?: Pedals): void {
    this.hold.push(analysis, pedals);
  }

  private rendered = "";

  private render(analysis: Analysis | null): void {
    const names = analysis?.chordNames ?? [];
    // Skip DOM rebuilds when nothing visible changed — with holdMs 0 this
    // runs on every note event even while the same chord is sounding.
    const sig = [
      names
        .slice(0, 4)
        .map((n) => `${n.kind}:${n.text}`)
        .join("|"),
      analysis?.romanNumeral ?? "",
      analysis?.inversion ?? "",
      analysis?.bassNote?.text ?? "",
    ].join("§");
    if (sig === this.rendered) return;
    this.rendered = sig;
    if (!analysis || names.length === 0) {
      this.nameEl.textContent = "—";
      this.nameEl.classList.add("ks-idle");
      this.rnEl.textContent = "";
      this.subEl.textContent = "";
      this.altEl.replaceChildren();
      return;
    }
    this.nameEl.classList.remove("ks-idle");
    const primary = names[0];
    this.nameEl.replaceChildren(...chordSpans(primary.text, primary.kind));
    this.rnEl.textContent = analysis.romanNumeral ?? "";

    const subParts: string[] = [];
    const kindLabel = KIND_LABEL[primary.kind];
    if (kindLabel) subParts.push(kindLabel);
    if (analysis.inversion != null && analysis.inversion > 0) {
      const ord = ["root", "1st inv", "2nd inv", "3rd inv", "4th inv", "5th inv"];
      subParts.push(ord[analysis.inversion] ?? `${analysis.inversion}th inv`);
    }
    this.subEl.textContent = subParts.join(" · ");

    this.altEl.replaceChildren(
      ...names.slice(1, 4).map((n) => {
        const span = document.createElement("span");
        span.className = "ks-chordcard-alt";
        span.replaceChildren(...chordSpans(n.text, n.kind));
        return span;
      }),
    );
  }
}
