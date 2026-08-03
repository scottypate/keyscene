// custom-staff.js — self-contained grand-staff chord renderer (zero deps).
//
// Renders a grand staff (treble + bass, bracket, clefs) with the currently-held
// chord as stacked whole noteheads, accidentals, and ledger lines, into an SVG.
//
// Note spec: { step: 'C'..'B', octave: int, accidental: ''|'#'|'##'|'b'|'bb'|'n' }
//
// Usage:
//   import { renderChord } from './custom-staff.js';
//   renderChord(containerEl, notes, { scale: 1, theme: {...} });
//
// Theming: every element is painted with CSS variables that fall back to the
// values in DEFAULT_THEME, so recoloring at runtime is either (a) set CSS vars
// on any ancestor, or (b) pass a theme object. No re-render needed for (a).

const SVG_NS = 'http://www.w3.org/2000/svg';

const STEP_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

// Vertical geometry (logical units; 1 staff space = SP).
const SP = 10;               // distance between adjacent staff lines
const HALF = SP / 2;         // distance between adjacent diatonic positions
const TREBLE_TOP_Y = 60;     // y of treble top line (F5)
const BASS_TOP_Y = TREBLE_TOP_Y + 4 * SP + 70; // y of bass top line (A3)
const STAFF_LEFT = 26;
const STAFF_RIGHT = 250;
const NOTE_X = 170;          // default notehead column center
const WIDTH = 270;
const HEIGHT = BASS_TOP_Y + 4 * SP + 60;

// Diatonic index: C0 = 0, each step up = +1. Middle C (C4) = 28.
const dia = (n) => n.octave * 7 + STEP_INDEX[n.step];
const MIDDLE_C = 28;
const TREBLE_TOP_DIA = dia({ step: 'F', octave: 5 }); // 38, top line
const BASS_TOP_DIA = dia({ step: 'A', octave: 3 });   // 26, top line

const ACCIDENTAL_GLYPH = { '#': '♯', b: '♭', n: '♮', '##': '\u{1D12A}', bb: '\u{1D12B}' };
// Approximate glyph widths in logical units, used for accidental column packing.
const ACCIDENTAL_WIDTH = { '#': 9, b: 8, n: 8, '##': 10, bb: 14 };

export const DEFAULT_THEME = {
  staff: '#222222',
  notehead: '#111111',
  accidental: '#111111',
  clef: '#222222',
  brace: '#222222',
  ledger: '#222222',
};

function el(name, attrs) {
  const e = document.createElementNS(SVG_NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

const paint = (theme, key) => `var(--ks-${key}, ${theme[key]})`;

/** y coordinate for a diatonic index on a given staff. */
function yFor(diaIdx, staff) {
  return staff === 'treble'
    ? TREBLE_TOP_Y + (TREBLE_TOP_DIA - diaIdx) * HALF
    : BASS_TOP_Y + (BASS_TOP_DIA - diaIdx) * HALF;
}

/**
 * Assign noteheads for one staff: sort ascending, flip noteheads of the upper
 * note of any second (adjacent diatonic positions) to the right side.
 */
function layoutNoteheads(notes) {
  const sorted = [...notes].sort((a, b) => dia(a) - dia(b));
  const placed = [];
  for (const n of sorted) {
    const d = dia(n);
    const prev = placed[placed.length - 1];
    const shifted = prev !== undefined && d - prev.d === 1 && !prev.shifted;
    placed.push({ note: n, d, shifted });
  }
  return placed;
}

/**
 * Greedy accidental column packing (top-down, standard-ish engraving order):
 * an accidental goes in the rightmost column where it doesn't vertically
 * collide with an accidental already in that column.
 */
function layoutAccidentals(placed) {
  const withAcc = placed.filter((p) => p.note.accidental).sort((a, b) => b.d - a.d);
  const columns = []; // each: array of {d}
  const out = [];
  const V_CLEARANCE = 6; // diatonic steps of clearance needed within a column
  for (const p of withAcc) {
    let col = 0;
    for (;;) {
      const occupants = columns[col] || [];
      if (occupants.every((o) => Math.abs(o.d - p.d) >= V_CLEARANCE)) break;
      col++;
    }
    (columns[col] ||= []).push({ d: p.d });
    out.push({ placed: p, col });
  }
  return out;
}

function drawStaffLines(g, topY, theme) {
  for (let i = 0; i < 5; i++) {
    g.appendChild(el('line', {
      x1: STAFF_LEFT, x2: STAFF_RIGHT, y1: topY + i * SP, y2: topY + i * SP,
      stroke: paint(theme, 'staff'), 'stroke-width': 1.2,
    }));
  }
}

function drawBracket(g, theme) {
  const top = TREBLE_TOP_Y;
  const bot = BASS_TOP_Y + 4 * SP;
  const x = STAFF_LEFT - 9;
  const stroke = paint(theme, 'brace');
  g.appendChild(el('line', { x1: x, x2: x, y1: top - 1.5, y2: bot + 1.5, stroke, 'stroke-width': 3 }));
  g.appendChild(el('path', { d: `M ${x - 1.5} ${top - 1} q 6 -1 9 -7`, fill: 'none', stroke, 'stroke-width': 2.5 }));
  g.appendChild(el('path', { d: `M ${x - 1.5} ${bot + 1} q 6 1 9 7`, fill: 'none', stroke, 'stroke-width': 2.5 }));
  // system left edge line joining both staves
  g.appendChild(el('line', {
    x1: STAFF_LEFT, x2: STAFF_LEFT, y1: top, y2: bot,
    stroke: paint(theme, 'staff'), 'stroke-width': 1.2,
  }));
}

function drawClefs(g, theme) {
  const fill = paint(theme, 'clef');
  // Unicode musical glyphs; rendered from system fonts. Sized relative to staff.
  const treble = el('text', {
    x: STAFF_LEFT + 6, y: TREBLE_TOP_Y + 3 * SP, fill,
    'font-size': 46, 'font-family': "'Bravura Text','Noto Music','Apple Symbols',serif",
    'dominant-baseline': 'middle',
  });
  treble.textContent = '\u{1D11E}'; // 𝄞
  const bass = el('text', {
    x: STAFF_LEFT + 6, y: BASS_TOP_Y + SP, fill,
    'font-size': 40, 'font-family': "'Bravura Text','Noto Music','Apple Symbols',serif",
    'dominant-baseline': 'middle',
  });
  bass.textContent = '\u{1D122}'; // 𝄢
  g.appendChild(treble);
  g.appendChild(bass);
}

/** Whole-note head: outer ellipse minus rotated inner hole, single evenodd path. */
function wholeNoteheadPath(cx, cy) {
  const rx = 7.2, ry = 4.8;      // outer
  const irx = 4.4, iry = 2.6;    // inner hole (rotated ~60deg)
  const outer = `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${2 * rx} 0 a ${rx} ${ry} 0 1 0 ${-2 * rx} 0`;
  const inner = `M ${cx - irx * 0.5} ${cy + iry * 0.8} a ${irx} ${iry} 60 1 0 ${irx} ${-iry * 1.6} a ${irx} ${iry} 60 1 0 ${-irx} ${iry * 1.6}`;
  return outer + ' ' + inner;
}

function drawLedgerLines(g, placed, staff, theme) {
  // Collect needed ledger line diatonic positions (even offsets from top/bottom line).
  const topDia = staff === 'treble' ? TREBLE_TOP_DIA : BASS_TOP_DIA;
  const bottomDia = topDia - 8;
  const lines = new Map(); // dia -> {minX, maxX}
  for (const p of placed) {
    const x = NOTE_X + (p.shifted ? 13.4 : 0);
    if (p.d > topDia) {
      for (let l = topDia + 2; l <= p.d; l += 2) {
        const cur = lines.get(l) || { min: x, max: x };
        lines.set(l, { min: Math.min(cur.min, x), max: Math.max(cur.max, x) });
      }
    } else if (p.d < bottomDia) {
      for (let l = bottomDia - 2; l >= p.d; l -= 2) {
        const cur = lines.get(l) || { min: x, max: x };
        lines.set(l, { min: Math.min(cur.min, x), max: Math.max(cur.max, x) });
      }
    }
  }
  for (const [d, ext] of lines) {
    // Ledger lines sit on "line" positions only (same parity as staff lines).
    if ((topDia - d) % 2 !== 0) continue;
    const y = yFor(d, staff);
    g.appendChild(el('line', {
      x1: ext.min - 11.5, x2: ext.max + 11.5, y1: y, y2: y,
      stroke: paint(theme, 'ledger'), 'stroke-width': 1.4,
    }));
  }
}

function drawChordOnStaff(g, notes, staff, theme) {
  if (notes.length === 0) return;
  const placed = layoutNoteheads(notes);
  drawLedgerLines(g, placed, staff, theme);
  for (const p of placed) {
    const cx = NOTE_X + (p.shifted ? 13.4 : 0);
    const cy = yFor(p.d, staff);
    g.appendChild(el('path', {
      d: wholeNoteheadPath(cx, cy),
      fill: paint(theme, 'notehead'),
      'fill-rule': 'evenodd',
    }));
  }
  // Accidentals: columns grow leftward from the leftmost notehead column.
  const accs = layoutAccidentals(placed);
  const baseX = NOTE_X - 12;
  for (const { placed: p, col } of accs) {
    const acc = p.note.accidental;
    const t = el('text', {
      x: baseX - col * 13, y: yFor(p.d, staff),
      fill: paint(theme, 'accidental'),
      'font-size': 22, 'text-anchor': 'end', 'dominant-baseline': 'middle',
      'font-family': "'Bravura Text','Noto Music','Apple Symbols',serif",
    });
    t.textContent = ACCIDENTAL_GLYPH[acc] || acc;
    g.appendChild(t);
  }
}

/**
 * Render the chord into `container` (any DOM element). Tears down previous
 * content and rebuilds — the realistic live-update model for this spike.
 * Returns the created <svg> element.
 */
export function renderChord(container, notes, { scale = 1, theme = DEFAULT_THEME } = {}) {
  container.textContent = '';
  const svg = el('svg', {
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    width: WIDTH * scale,
    height: HEIGHT * scale,
    xmlns: SVG_NS,
  });
  const g = el('g', {});
  svg.appendChild(g);

  drawBracket(g, theme);
  drawStaffLines(g, TREBLE_TOP_Y, theme);
  drawStaffLines(g, BASS_TOP_Y, theme);
  drawClefs(g, theme);

  const treble = notes.filter((n) => dia(n) >= MIDDLE_C);
  const bass = notes.filter((n) => dia(n) < MIDDLE_C);
  drawChordOnStaff(g, treble, 'treble', theme);
  drawChordOnStaff(g, bass, 'bass', theme);

  container.appendChild(svg);
  return svg;
}
