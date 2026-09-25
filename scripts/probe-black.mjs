#!/usr/bin/env node
/** Diagnostics: force an attack and sample the frame + NaN checks every 100 ms. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const attack = process.argv[2] ?? 'stomp';
const out = path.resolve(root, 'test-output/probe-black');
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = await createServer({ root, server: { port: 5739, strictPort: false, hmr: false }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log('console', m.type(), m.text().slice(0, 200)));
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${server.resolvedUrls.local[0]}?test=1&god=1`);
await page.waitForFunction(() => window.__CO?.ready && window.__CO.state().flow === 'title');
await page.evaluate(() => window.__CO.begin());
await page.evaluate(() => window.__CO.skipIntro());
await page.waitForFunction(() => window.__CO.state().flow === 'fight', null, { timeout: 20000 });
await page.keyboard.press('KeyQ');
await page.evaluate(() => window.__CO.teleportPlayer(0, 6));
await sleep(500);
await page.evaluate((a) => window.__CO.forceAttack(a, 'L'), attack);
for (let i = 0; i < 40; i++) {
  await sleep(100);
  const info = await page.evaluate(() => {
    const g = window.__game;
    const bad = [];
    g.golem.rig.root.traverse((o) => {
      const e = o.matrixWorld.elements;
      if (e.some((v) => !Number.isFinite(v))) bad.push(o.name || o.type);
    });
    const cam = g.cam.camera;
    const camBad = cam.matrixWorld.elements.some((v) => !Number.isFinite(v)) || cam.projectionMatrix.elements.some((v) => !Number.isFinite(v));
    return { step: g.golem.step, bad: bad.slice(0, 6), nBad: bad.length, camBad, fov: cam.fov, cam: cam.position.toArray().map((v) => +v.toFixed(2)) };
  });
  const buf = await page.screenshot({ path: path.join(out, `${String(i).padStart(2, '0')}.png`) });
  // mean brightness of the screenshot (PNG decode is overkill; use size as a proxy for content)
  console.log(i, info.step.padEnd(8), 'nanNodes', info.nBad, info.bad.join(','), 'camBad', info.camBad, 'fov', info.fov.toFixed(1), 'cam', info.cam.join(','), 'png', buf.length);
}
await browser.close();
await server.close();
