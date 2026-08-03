// bench.js — renders the same ~200-chord sequence through both renderers at
// scales 0.5/1/2/4, measuring per-chord-change teardown+redraw latency.

import { makeChordSequence, SHOWCASE_CHORD } from './chords.js';
import * as custom from './custom-staff.js';
import * as vf from './vexflow-staff.js';

const SCALES = [0.5, 1, 2, 4];
const WARMUP = 20;
const renderers = { vexflow: vf.renderChord, custom: custom.renderChord };

function stats(times) {
  const s = [...times].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const round = (v) => Math.round(v * 1000) / 1000;
  return {
    n: s.length,
    median: round(q(0.5)),
    p95: round(q(0.95)),
    max: round(s[s.length - 1]),
    mean: round(s.reduce((a, b) => a + b, 0) / s.length),
  };
}

function forceFlush(stage) {
  // Force synchronous layout so deferred work is included in the measurement.
  void stage.offsetHeight;
  const svg = stage.querySelector('svg');
  if (svg) void svg.getBBox();
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

async function benchOne(name, render, chords, scale, stage) {
  // Warmup (unmeasured): JIT, font shaping, style caches.
  for (let i = 0; i < WARMUP; i++) {
    render(stage, chords[i % chords.length].notes, { scale });
    forceFlush(stage);
  }
  await nextFrame();
  const times = [];
  for (const chord of chords) {
    const t0 = performance.now();
    render(stage, chord.notes, { scale });
    forceFlush(stage);
    times.push(performance.now() - t0);
    // Yield occasionally so the tab stays responsive / GC can run off-clock.
    if (times.length % 50 === 0) await nextFrame();
  }
  return stats(times);
}

async function runBench() {
  const chords = makeChordSequence(200);
  const stage = document.getElementById('stage');
  const results = {
    meta: {
      chords: chords.length,
      warmup: WARMUP,
      scales: SCALES,
      userAgent: navigator.userAgent,
      vexflowVersion: window.VexFlow?.BUILD?.VERSION,
      date: new Date().toISOString(),
    },
    results: {},
  };
  for (const name of Object.keys(renderers)) {
    results.results[name] = {};
    for (const scale of SCALES) {
      results.results[name][`x${scale}`] =
        await benchOne(name, renderers[name], chords, scale, stage);
      await nextFrame();
    }
  }
  stage.textContent = '';
  return results;
}

function renderResultsTable(results) {
  const out = document.getElementById('results');
  let html = '<h2>Results (ms per chord change, teardown+redraw)</h2>';
  for (const [name, byScale] of Object.entries(results.results)) {
    html += `<h3>${name}</h3><table border="1" cellpadding="4"><tr><th>scale</th><th>median</th><th>p95</th><th>max</th><th>mean</th></tr>`;
    for (const [scale, s] of Object.entries(byScale)) {
      html += `<tr><td>${scale}</td><td>${s.median}</td><td>${s.p95}</td><td>${s.max}</td><td>${s.mean}</td></tr>`;
    }
    html += '</table>';
  }
  html += `<pre>${JSON.stringify(results, null, 2)}</pre>`;
  out.innerHTML = html;
}

function renderShowcase() {
  // Side-by-side showcase for screenshots / eyeballing: C#dim7 across both staves.
  for (const scale of [1, 2]) {
    for (const [name, render] of Object.entries(renderers)) {
      const holder = document.createElement('div');
      holder.id = `showcase-${name}-x${scale}`;
      holder.style.cssText = 'display:inline-block;vertical-align:top;margin:8px;background:#fff;';
      const label = document.createElement('div');
      label.textContent = `${name} @ ${scale}x`;
      label.style.cssText = 'font:12px sans-serif;padding:2px;';
      document.getElementById('showcase').appendChild(holder);
      holder.appendChild(label);
      const target = document.createElement('div');
      holder.appendChild(target);
      render(target, SHOWCASE_CHORD, { scale });
    }
  }
}

async function main() {
  const params = new URLSearchParams(location.search);
  await (document.fonts?.ready ?? Promise.resolve());
  if (params.has('showcase')) {
    renderShowcase();
    window.__showcaseReady = true;
    return;
  }
  const results = await runBench();
  renderResultsTable(results);
  window.__benchResults = results;
}

main().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:red">${e.stack}</pre>`);
  window.__benchError = String(e.stack || e);
});
