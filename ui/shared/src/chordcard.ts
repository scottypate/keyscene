// Big current-chord readout + alternate names + Roman numeral (§3.3).
// Never blank: single notes show the note name, dyads the interval —
// the engine already names those (NameKind single/dyad).

import type { Analysis } from "./types";

const KIND_LABEL: Record<string, string> = {
  polychord: "polychord",
  quartal: "quartal",
  cluster: "cluster",
  dyad: "interval",
  single: "note",
};

export class ChordCard {
  private nameEl: HTMLDivElement;
  private rnEl: HTMLDivElement;
  private altEl: HTMLDivElement;
  private subEl: HTMLDivElement;

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
    this.update(null);
  }

  update(analysis: Analysis | null): void {
    const names = analysis?.chordNames ?? [];
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
    this.nameEl.textContent = primary.text;
    this.rnEl.textContent = analysis.romanNumeral ?? "";

    const subParts: string[] = [];
    const kindLabel = KIND_LABEL[primary.kind];
    if (kindLabel) subParts.push(kindLabel);
    if (analysis.inversion != null && analysis.inversion > 0) {
      const ord = ["root", "1st inv", "2nd inv", "3rd inv", "4th inv", "5th inv"];
      subParts.push(ord[analysis.inversion] ?? `${analysis.inversion}th inv`);
    }
    if (analysis.bassNote && primary.kind !== "single") {
      subParts.push(`bass ${analysis.bassNote.text}`);
    }
    this.subEl.textContent = subParts.join(" · ");

    this.altEl.replaceChildren(
      ...names.slice(1, 4).map((n) => {
        const span = document.createElement("span");
        span.className = "ks-chordcard-alt";
        span.textContent = n.text;
        return span;
      }),
    );
  }
}
