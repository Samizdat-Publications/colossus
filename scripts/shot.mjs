#!/usr/bin/env node
/**
 * Quick screenshot helper for debug views.
 *   node scripts/shot.mjs "<query string>" out.png [--flag __poseSheetReady] [--w 1600 --h 1000] [--wait 500]
 * Starts a Vite dev server on a free port, opens /?<query>, waits for window[flag], screenshots.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const query = args[0] ?? '';
const out = path.resolve(root, args[1] ?? 'test-output/shot.png');
const flag = opt('flag', '__poseSheetReady');
const width = Number(opt('w', 1600));
const height = Number(opt('h', 1000));
const wait = Number(opt('wait', 300));

const server = await createServer({ root, server: { port: 5519, strictPort: false }, logLevel: 'warn' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width, height } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack ?? e}`));
await page.goto(`${base}?${query}`);
try {
  await page.waitForFunction((f) => window[f], flag, { timeout: 60000 });
} catch (e) {
  console.log('flag not reached', e.message);
}
await page.waitForTimeout(wait);
await page.screenshot({ path: out });
console.log('saved', out);
for (const l of logs) console.log(l);
await browser.close();
await server.close();
