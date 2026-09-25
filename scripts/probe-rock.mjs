#!/usr/bin/env node
/** Diagnostics: screenshot a rock throw every 120 ms from the player camera. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, 'test-output/probe-rock');
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = await createServer({ root, server: { port: 5749, strictPort: false, hmr: false }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${server.resolvedUrls.local[0]}?test=1&god=1`);
await page.waitForFunction(() => window.__CO?.ready && window.__CO.state().flow === 'title');
await page.evaluate(() => window.__CO.begin());
await page.evaluate(() => window.__CO.skipIntro());
await page.waitForFunction(() => window.__CO.state().flow === 'fight' && window.__CO.state().golem.state === 'combat', null, { timeout: 20000 });
await page.keyboard.press('KeyQ');
await page.evaluate(() => window.__CO.teleportPlayer(4, 24));
await sleep(800);
await page.evaluate(() => window.__CO.forceAttack('throw', 'R'));
for (let i = 0; i < 24; i++) {
  await sleep(120);
  const s = await page.evaluate(() => {
    const st = window.__CO.state();
    const cam = window.__game.cam.camera;
    const rocks = window.__game.threats.rocks.map((r) => {
      const v = r.pos.clone().project(cam);
      return { y: +r.pos.y.toFixed(1), ndc: [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(3)] };
    });
    return { step: st.golem.step, rocks, held: window.__game.golem.heldRock };
  });
  await page.screenshot({ path: path.join(out, `${String(i).padStart(2, '0')}.png`) });
  console.log(i, s.step, 'held', s.held, JSON.stringify(s.rocks));
}
await browser.close();
await server.close();
