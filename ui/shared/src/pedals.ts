// Sustain / sostenuto / soft pedal indicator (§3.1, §3.4 element).

import type { Pedals } from "./types";

const PEDALS: { key: keyof Pedals; label: string }[] = [
  { key: "soft", label: "soft" },
  { key: "sostenuto", label: "sost" },
  { key: "sustain", label: "sus" },
];

export class PedalIndicator {
  private dots = new Map<keyof Pedals, HTMLSpanElement>();

  constructor(container: HTMLElement) {
    container.classList.add("ks-pedals");
    for (const { key, label } of PEDALS) {
      const wrap = document.createElement("span");
      wrap.className = "ks-pedal";
      const dot = document.createElement("span");
      dot.className = "ks-pedal-dot";
      const text = document.createElement("span");
      text.textContent = label;
      wrap.append(dot, text);
      container.appendChild(wrap);
      this.dots.set(key, dot);
    }
  }

  update(pedals: Pedals): void {
    for (const [key, dot] of this.dots) {
      dot.classList.toggle("ks-on", pedals[key]);
    }
  }
}
