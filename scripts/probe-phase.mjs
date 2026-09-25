#!/usr/bin/env node
/**
 * Diagnostics: stagger the golem with the expert bot playing, then request phase 2 and log the golem's
 * state changes for 40 s (checks that the phase-change roar always starts).
 *   node scripts/probe-phase.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = await createServer({ root, server: { port: 5630 + Math.floor(Math.random() * 60), strictPort: false }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${server.resolvedUrls.local[0]}?test=1&god=1&nosound=1`);
await page.waitForFunction(() => window.__CO?.ready && window.__CO.state().flow === 'title', null, { timeout: 90000 });
await page.evaluate(() => window.__CO.begin());
await page.evaluate(() => window.__CO.skipIntro());
await page.waitForFunction(() => window.__CO.state().flow === 'fight', null, { timeout: 20000 });
await page.evaluate(() => window.__CO.bot('expert'));
await page.evaluate(() => { window.__game.golem.breakMeter = 95; });
const t0 = Date.now();
let last = '';
for (let i = 0; i < 400; i++) {
  const s = await page.evaluate(() => {
    const g = window.__CO.state().golem;
    return `${g.state}/${g.attack ?? '-'}/${g.step} phase=${g.phase} hp=${g.hpFrac} break=${g.breakMeter}`;
  });
  const key = s.replace(/ hp=.*$/, '');
  if (key !== last) {
    console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(5), s);
    last = key;
  }
  if (i === 60) {
    console.log('--- request phase 2');
    await page.evaluate(() => window.__CO.setGolemPhase(2));
  }
  await sleep(100);
}
await browser.close();
await server.close();
