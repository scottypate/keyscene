// vexflow-staff.js — grand-staff chord rendering via VexFlow 5 (global `VexFlow`
// from the CJS/UMD bundle loaded in bench.html).
//
// Same contract as custom-staff.js: renderChord(container, notes, {scale, theme})
// with note spec {step, octave, accidental}. Full teardown + redraw per call.

const STEP_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const dia = (n) => n.octave * 7 + STEP_INDEX[n.step];
const MIDDLE_C = 28;

const WIDTH = 270;
const HEIGHT = 340;

export const DEFAULT_THEME = {
  staff: '#222222',
  notehead: '#111111',
  accidental: '#111111',
  clef: '#222222',
  brace: '#222222',
};

function toKey(n) {
  const acc = n.accidental === 'n' ? 'n' : n.accidental; // vexflow uses #,##,b,bb,n
  return `${n.step.toLowerCase()}${acc}/${n.octave}`;
}

function buildVoice(VF, notes, clef, theme) {
  const sorted = [...notes].sort((a, b) => dia(a) - dia(b));
  const staveNote = new VF.StaveNote({
    keys: sorted.map(toKey),
    duration: 'w',
    clef,
  });
  sorted.forEach((n, i) => {
    if (n.accidental) {
      const acc = new VF.Accidental(n.accidental);
      acc.setStyle({ fillStyle: theme.accidental, strokeStyle: theme.accidental });
      staveNote.addModifier(acc, i);
    }
  });
  staveNote.setStyle({ fillStyle: theme.notehead, strokeStyle: theme.notehead });
  staveNote.setLedgerLineStyle({ strokeStyle: theme.staff });
  const voice = new VF.Voice({ numBeats: 4, beatValue: 4 });
  voice.setMode(VF.Voice.Mode.SOFT);
  voice.addTickables([staveNote]);
  return voice;
}

export function renderChord(container, notes, { scale = 1, theme = DEFAULT_THEME } = {}) {
  const VF = window.VexFlow;
  container.textContent = '';
  const renderer = new VF.Renderer(container, VF.Renderer.Backends.SVG);
  renderer.resize(WIDTH * scale, HEIGHT * scale);
  const ctx = renderer.getContext();
  ctx.scale(scale, scale);

  const staveStyle = { fillStyle: theme.staff, strokeStyle: theme.staff };
  const treble = new VF.Stave(20, 40, WIDTH - 30);
  treble.addClef('treble');
  treble.setBegBarType(VF.Barline.type.NONE);
  treble.setEndBarType(VF.Barline.type.NONE);
  treble.setStyle(staveStyle);
  const bass = new VF.Stave(20, 170, WIDTH - 30);
  bass.addClef('bass');
  bass.setBegBarType(VF.Barline.type.NONE);
  bass.setEndBarType(VF.Barline.type.NONE);
  bass.setStyle(staveStyle);

  // Clefs are stave modifiers with their own style; stave.setStyle doesn't cascade.
  const clefStyle = { fillStyle: theme.clef ?? theme.staff, strokeStyle: theme.clef ?? theme.staff };
  for (const stave of [treble, bass]) {
    stave.getModifiers().forEach((m) => m.setStyle && m.setStyle(clefStyle));
  }

  treble.setContext(ctx).draw();
  bass.setContext(ctx).draw();

  const brace = new VF.StaveConnector(treble, bass).setType(VF.StaveConnector.type.BRACE);
  brace.setStyle({ fillStyle: theme.brace, strokeStyle: theme.brace });
  brace.setContext(ctx).draw();
  const leftLine = new VF.StaveConnector(treble, bass).setType(VF.StaveConnector.type.SINGLE_LEFT);
  leftLine.setStyle(staveStyle);
  leftLine.setContext(ctx).draw();

  const trebleNotes = notes.filter((n) => dia(n) >= MIDDLE_C);
  const bassNotes = notes.filter((n) => dia(n) < MIDDLE_C);

  const voices = [];
  const formatter = new VF.Formatter();
  let trebleVoice = null;
  let bassVoice = null;
  if (trebleNotes.length) {
    trebleVoice = buildVoice(VF, trebleNotes, 'treble', theme);
    formatter.joinVoices([trebleVoice]);
    voices.push(trebleVoice);
  }
  if (bassNotes.length) {
    bassVoice = buildVoice(VF, bassNotes, 'bass', theme);
    formatter.joinVoices([bassVoice]);
    voices.push(bassVoice);
  }
  if (voices.length) {
    formatter.format(voices, WIDTH - 130);
    if (trebleVoice) trebleVoice.draw(ctx, treble);
    if (bassVoice) bassVoice.draw(ctx, bass);
  }
  return container.querySelector('svg');
}
