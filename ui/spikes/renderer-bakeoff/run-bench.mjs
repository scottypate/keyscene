// run-bench.mjs — serve the spike dir, run bench.html headless in chromium via
// Playwright, print window.__benchResults JSON, and capture showcase screenshots.
//
//   node run-bench.mjs              # benchmark + screenshots
//   node run-bench.mjs --no-shots   # benchmark only

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.map': 'application/json',
};

const server = http.createServer(async (req, res) => {
  try {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '');
    const file = join(ROOT, path === '' ? 'bench.html' : path);
    if (!file.startsWith(ROOT)) throw new Error('forbidden');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1600 } });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));

// --- benchmark ---
await page.goto(`${base}/bench.html`);
await page.waitForFunction(() => window.__benchResults || window.__benchError, null, { timeout: 180_000 });
const error = await page.evaluate(() => window.__benchError);
if (error) {
  console.error('BENCH ERROR:\n' + error);
  process.exitCode = 1;
} else {
  const results = await page.evaluate(() => window.__benchResults);
  console.log(JSON.stringify(results, null, 2));
}

// --- screenshots ---
if (!process.argv.includes('--no-shots') && !process.exitCode) {
  await page.goto(`${base}/bench.html?showcase`);
  await page.waitForFunction(() => window.__showcaseReady, null, { timeout: 30_000 });
  for (const name of ['vexflow', 'custom']) {
    for (const scale of [1, 2]) {
      const el = page.locator(`#showcase-${name}-x${scale}`);
      const path = join(ROOT, `screenshot-${name}-x${scale}.png`);
      await el.screenshot({ path });
      console.error(`saved ${path}`);
    }
  }
}

await browser.close();
server.close();
