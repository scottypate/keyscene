// Grand-staff renderer wrapping VexFlow 5 behind our {letter, acc, octave}
// note-spec (ADR-001). All API gotchas from the Phase 0 spike are encoded
// here and only here:
//   - Voice.Mode.SOFT (avoid tick-count errors)
//   - barlines suppressed via setBegBarType/setEndBarType
//   - notes pre-sorted ascending and deduped before building StaveNotes
//   - accidentals are index-coupled modifiers, not note properties
//   - empty staves get conditional voice handling
//   - theming is baked at draw time (setStyle does not cascade: iterate
//     stave.getModifiers(), use setLedgerLineStyle) — full re-render on
//     theme change (~0.3 ms, ADR-001)

// vexflow/bravura instead of the default entry: the app only uses the
// Bravura + Academico fonts; the full entry eagerly embeds four more
// (~400 KB of base64 font data in the bundle).
import {
  Accidental,
  Barline,
  Formatter,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  Voice,
} from "vexflow/bravura";
import type { SpelledNote } from "./types";
import type { Theme } from "./theme";

const WIDTH = 420;
const HEIGHT = 300;
const STAVE_X = 16;
const STAVE_W = WIDTH - 32;

/** Sharps/flats count per key name; positive = sharps, negative = flats. */
const KEY_SIG_COUNT: Record<string, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, Db: -5, Ab: -4, Eb: -3, Bb: -2, F: -1,
  Am: 0, Em: 1, Bm: 2, "F#m": 3, "C#m": 4, "G#m": 5, Ebm: -6, Bbm: -5, Fm: -4, Cm: -3, Gm: -2, Dm: -1,
};
const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];

/** letter → accidental (-1|0|1) implied by the key signature. */
function keySigMap(key: string | null): Record<string, number> {
  const map: Record<string, number> = {};
  const count = key ? KEY_SIG_COUNT[key] : undefined;
  if (count === undefined || count === 0) return map;
  const order = count > 0 ? SHARP_ORDER : FLAT_ORDER;
  for (let i = 0; i < Math.abs(count); i++) map[order[i]] = Math.sign(count);
  return map;
}

/** VexFlow key-signature spec: major key name, or relative-major of minor. */
function vexKeySpec(key: string): string {
  const count = KEY_SIG_COUNT[key] ?? 0;
  const majors = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"];
  return majors[count + 7];
}

const ACC_GLYPH: Record<number, string> = { [-2]: "bb", [-1]: "b", 0: "n", 1: "#", 2: "##" };

export class Staff {
  private container: HTMLElement;
  private theme: Theme;
  private notes: SpelledNote[] = [];
  private key: string | null = null;
  private drawnSig = "";

  constructor(container: HTMLElement, theme: Theme) {
    this.container = container;
    this.theme = theme;
    this.draw();
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.drawnSig = "";
    this.draw();
  }

  render(notes: SpelledNote[], key: string | null): void {
    this.notes = notes;
    this.key = key;
    this.draw();
  }

  /** Skip the full VexFlow rebuild when nothing on the staff changed —
   *  render() runs on every MIDI event, including pedal-only ones. */
  private sig(): string {
    return `${this.key}|${this.notes.map((n) => n.text + n.octave).join(",")}`;
  }

  private draw(): void {
    const drawSig = this.sig();
    if (drawSig === this.drawnSig) return;
    this.drawnSig = drawSig;
    this.container.replaceChildren();
    const renderer = new Renderer(this.container as HTMLDivElement, Renderer.Backends.SVG);
    renderer.resize(WIDTH, HEIGHT);
    const ctx = renderer.getContext();
    const ink = { fillStyle: this.theme.ink, strokeStyle: this.theme.ink };

    const treble = new Stave(STAVE_X, 40, STAVE_W).addClef("treble");
    const bass = new Stave(STAVE_X, 150, STAVE_W).addClef("bass");
    for (const stave of [treble, bass]) {
      if (this.key) stave.addKeySignature(vexKeySpec(this.key));
      stave.setBegBarType(Barline.type.NONE);
      stave.setEndBarType(Barline.type.NONE);
      stave.setStyle(ink);
      for (const m of stave.getModifiers()) m.setStyle(ink);
      stave.setContext(ctx).draw();
    }
    for (const type of [StaveConnector.type.BRACE, StaveConnector.type.SINGLE_LEFT]) {
      const conn = new StaveConnector(treble, bass).setType(type);
      conn.setStyle(ink);
      conn.setContext(ctx).draw();
    }

    // Pre-sort ascending by midi, dedupe identical spellings.
    const sorted = [...this.notes].sort((a, b) => a.midi - b.midi);
    const seen = new Set<string>();
    const deduped = sorted.filter((n) => {
      const k = `${n.letter}${n.acc}/${n.octave}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const sig = keySigMap(this.key);
    const trebleNotes = deduped.filter((n) => n.midi >= 60);
    const bassNotes = deduped.filter((n) => n.midi < 60);

    const build = (group: SpelledNote[], clef: string): StaveNote | null => {
      if (group.length === 0) return null;
      const note = new StaveNote({
        keys: group.map((n) => `${n.letter.toLowerCase()}/${n.octave}`),
        duration: "w",
        clef,
      });
      group.forEach((n, i) => {
        const implied = sig[n.letter] ?? 0;
        if (n.acc !== implied) {
          note.addModifier(new Accidental(ACC_GLYPH[n.acc]), i);
        }
      });
      note.setStyle(ink);
      note.setLedgerLineStyle({ strokeStyle: this.theme.ink });
      return note;
    };

    const chords: [StaveNote | null, Stave][] = [
      [build(trebleNotes, "treble"), treble],
      [build(bassNotes, "bass"), bass],
    ];
    for (const [note, stave] of chords) {
      if (!note) continue; // empty stave: no voice at all
      const voice = new Voice({ numBeats: 4, beatValue: 4 }).setMode(Voice.Mode.SOFT);
      voice.addTickables([note]);
      new Formatter().joinVoices([voice]).format([voice], STAVE_W - 120);
      voice.draw(ctx, stave);
    }

    // Make the SVG scale to its container.
    const svg = this.container.querySelector("svg");
    if (svg) {
      svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.style.width = "100%";
      svg.style.height = "100%";
    }
  }
}
