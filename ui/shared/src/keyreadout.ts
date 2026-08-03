// Key / Roman-numeral readout (§3.4 Display element). Shows the selected
// key context and the current chord's Roman numeral, with the same
// anti-flicker hold as the chord card so the RN doesn't strobe.

import { AnalysisHold } from "./hold";
import type { Analysis, Pedals } from "./types";

export class KeyReadout {
  private keyEl: HTMLDivElement;
  private rnEl: HTMLDivElement;
  private hold = new AnalysisHold((a) => this.render(a));

  constructor(container: HTMLElement) {
    container.classList.add("ks-keyreadout");
    this.keyEl = document.createElement("div");
    this.keyEl.className = "ks-keyreadout-key";
    this.rnEl = document.createElement("div");
    this.rnEl.className = "ks-keyreadout-rn";
    container.replaceChildren(this.keyEl, this.rnEl);
    this.setKey(null);
    this.render(null);
  }

  setHoldMs(ms: number): void {
    this.hold.setHoldMs(ms);
  }

  setKey(key: string | null): void {
    if (!key) {
      this.keyEl.textContent = "No key";
    } else if (key.endsWith("m")) {
      this.keyEl.textContent = `${key.slice(0, -1)} minor`;
    } else {
      this.keyEl.textContent = `${key} major`;
    }
  }

  update(analysis: Analysis | null, pedals?: Pedals): void {
    this.hold.push(analysis, pedals);
  }

  private render(analysis: Analysis | null): void {
    this.rnEl.textContent = analysis?.romanNumeral ?? "";
  }
}
