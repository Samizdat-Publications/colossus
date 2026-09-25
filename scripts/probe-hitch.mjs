#!/usr/bin/env node
/**
 * First-use hitches: records every frame's duration while the fight plays its first slam, stagger,
 * phase 2 and phase 3 changes, and reports the longest frames with what was happening.
 *   node scripts/probe-hitch.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = await createServer({ root, server: { port: 5630 + Math.floor(Math.random() * 60), strictPort: false, hmr: false }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${server.resolvedUrls.local[0]}?test=1&god=1&nosound=1`);
await page.waitForFunction(() => window.__CO?.ready && window.__CO.state().flow === 'title', null, { timeout: 90000 });
await page.evaluate(() => {
  window.__frames = [];
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    const g = window.__game;
    window.__frames.push({ ms: now - last, flow: g.flow, st: g.golem.state, step: g.golem.step, atk: g.golem.attack?.name ?? '' });
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.click('button[data-act="begin"]');
await sleep(12000);
await page.waitForFunction(() => window.__CO.state().flow === 'fight', null, { timeout: 30000 });
await page.evaluate(() => window.__CO.bot('expert'));
await sleep(6000);
await page.evaluate(() => {
  const g = window.__game.golem;
  g.startStagger();
});
await sleep(8000);
await page.evaluate(() => window.__CO.forcePhase(2));
await sleep(8000);
await page.evaluate(() => window.__CO.forcePhase(3));
await sleep(10000);
await page.evaluate(() => window.__CO.killGolem());
await sleep(6000);
const frames = await page.evaluate(() => window.__frames);
const sorted = frames.map((f, i) => ({ ...f, i })).sort((a, b) => b.ms - a.ms).slice(0, 14);
console.log('frames', frames.length);
for (const f of sorted) console.log(`${f.ms.toFixed(0).padStart(5)} ms  #${f.i}  ${f.flow} ${f.st} ${f.atk} ${f.step}`);
console.log('errors', errors);
await browser.close();
await server.close();
