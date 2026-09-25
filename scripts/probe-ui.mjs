#!/usr/bin/env node
/**
 * Menu check with real input: title -> How to fight -> back -> Settings (keyboard slider change, persisted)
 * -> back -> Begin -> pause (Esc) -> settings from pause -> back -> resume. Screenshots and a report.
 *   node scripts/probe-ui.mjs [--out dir]
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = path.resolve(root, args[args.indexOf('--out') + 1] && args.includes('--out') ? args[args.indexOf('--out') + 1] : 'test-output/ui');
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = await createServer({ root, server: { port: 5630 + Math.floor(Math.random() * 60), strictPort: false, hmr: false }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`${server.resolvedUrls.local[0]}?test=1&nosound=1`);
await page.waitForFunction(() => window.__CO?.ready && window.__CO.state().flow === 'title', null, { timeout: 90000 });
const shot = (n) => page.screenshot({ path: path.join(outDir, `${n}.png`) });
// hold keys for a couple of frames: the game reads key state once per frame
const press = async (k) => {
  await page.keyboard.down(k);
  await sleep(70);
  await page.keyboard.up(k);
  await sleep(50);
};
const screen = () => page.evaluate(() => window.__game.screens.current);
const r = {};
await sleep(800);
await page.click('button[data-act="howto"]');
await sleep(300);
r.howto = await screen();
await shot('howto');
await page.click('button[data-act="back"]');
await sleep(200);
r.backToTitle = await screen();
await page.click('button[data-act="settings"]');
await sleep(300);
r.settings = await screen();
const before = await page.evaluate(() => window.__game.settings.music);
// keyboard: focus the music slider (third item) and press right twice
await press('ArrowDown');
await press('ArrowDown');
await press('ArrowDown');
await press('ArrowLeft');
await press('ArrowLeft');
await sleep(100);
const after = await page.evaluate(() => window.__game.settings.music);
r.musicChanged = before !== after;
r.persisted = await page.evaluate(() => {
  try {
    return JSON.parse(localStorage.getItem('colossus.settings.v1') ?? '{}').music;
  } catch {
    return null;
  }
});
await shot('settings');
await press('Escape');
await sleep(200);
r.escBack = await screen();
await page.click('button[data-act="begin"]');
await page.evaluate(() => window.__CO.skipIntro());
await page.waitForFunction(() => window.__CO.state().flow === 'fight', null, { timeout: 20000 });
await sleep(800);
await press('Escape');
await sleep(300);
r.paused = await screen();
await shot('pause');
await page.click('button[data-act="settings"]');
await sleep(200);
r.settingsFromPause = await screen();
await page.click('button[data-act="back"]');
await sleep(200);
r.backToPause = await screen();
await page.click('button[data-act="resume"]');
await sleep(300);
r.resumed = await page.evaluate(() => !window.__game.paused && window.__game.screens.current === 'none');
r.errors = errors;
console.log(JSON.stringify(r, null, 1));
await browser.close();
await server.close();
