// chords.js — deterministic sequence of ~200 realistic chord changes shared by
// both renderers. Seeded PRNG so every run measures the identical workload.

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const noteFromDia = (d, accidental = '') => ({
  step: STEPS[((d % 7) + 7) % 7],
  octave: Math.floor(d / 7),
  accidental,
});
const dia = (n) => n.octave * 7 + STEP_INDEX[n.step];

const ACCS = ['', '', '', '#', 'b', 'n', '##', 'bb']; // plain notes weighted heavier

/** Build a stacked chord from a root diatonic index and interval pattern. */
function stack(rootDia, intervals, rnd, accChance = 0.35) {
  const seen = new Set();
  const notes = [];
  for (const iv of intervals) {
    const d = rootDia + iv;
    if (seen.has(d)) continue;
    seen.add(d);
    const acc = rnd() < accChance ? ACCS[Math.floor(rnd() * ACCS.length)] : '';
    notes.push(noteFromDia(d, acc));
  }
  return notes;
}

export function makeChordSequence(count = 200, seed = 0xC0FFEE) {
  const rnd = mulberry32(seed);
  const chords = [];
  const kinds = ['single', 'triad', 'seventh', 'twoHand', 'cluster', 'tenNote', 'wide'];
  for (let i = 0; i < count; i++) {
    const kind = kinds[i % kinds.length];
    let notes;
    switch (kind) {
      case 'single':
        notes = stack(14 + Math.floor(rnd() * 28), [0], rnd, 0.5); // E2..~E6 area
        break;
      case 'triad':
        notes = stack(21 + Math.floor(rnd() * 18), [0, 2, 4], rnd);
        break;
      case 'seventh':
        notes = stack(21 + Math.floor(rnd() * 16), [0, 2, 4, 6], rnd);
        break;
      case 'twoHand': { // bass root+fifth, treble 7th chord — spans both staves
        const root = 12 + Math.floor(rnd() * 8); // C2..
        notes = [
          ...stack(root, [0, 4], rnd, 0.25),
          ...stack(root + 14, [0, 2, 4, 6], rnd),
        ];
        break;
      }
      case 'cluster': // tight seconds with accidentals — collision stress test
        notes = stack(24 + Math.floor(rnd() * 12), [0, 1, 2, 3], rnd, 0.85);
        break;
      case 'tenNote': { // big two-handed 10-note voicing
        const root = 10 + Math.floor(rnd() * 6);
        notes = [
          ...stack(root, [0, 4, 7, 9, 11], rnd, 0.3),
          ...stack(root + 16, [0, 2, 4, 6, 8], rnd, 0.4),
        ];
        break;
      }
      case 'wide': // extremes with ledger lines both directions
        notes = [
          ...stack(8 + Math.floor(rnd() * 4), [0, 4], rnd, 0.4),   // low, below bass staff
          ...stack(42 + Math.floor(rnd() * 5), [0, 2], rnd, 0.4),  // high, above treble staff
        ];
        break;
    }
    // Dedupe identical diatonic positions across hands (VexFlow dislikes exact dupes).
    const seen = new Set();
    notes = notes.filter((n) => {
      const d = dia(n);
      if (seen.has(d)) return false;
      seen.add(d);
      return true;
    });
    chords.push({ kind, notes });
  }
  return chords;
}

// Representative showcase chord: C# dim7 spread across both staves.
export const SHOWCASE_CHORD = [
  { step: 'C', octave: 2, accidental: '#' },
  { step: 'B', octave: 2, accidental: 'b' },
  { step: 'E', octave: 3, accidental: '' },
  { step: 'G', octave: 3, accidental: '' },
  { step: 'C', octave: 4, accidental: '#' },
  { step: 'E', octave: 4, accidental: '' },
  { step: 'G', octave: 4, accidental: '' },
  { step: 'B', octave: 4, accidental: 'b' },
  { step: 'C', octave: 5, accidental: '#' },
];
