#!/usr/bin/env node
/**
 * Look at one golem state from several fixed cameras (front, three-quarter, side, back), with the
 * simulation frozen: `node scripts/probe-pose.mjs [stagger|idle|dead] [--out dir] [--phase n]`.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const what = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) ?? 'stagger';
const opt = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const outDir = path.resolve(root, opt('--out', `test-output/pose-${what}`));
const phase = Number(opt('--phase', '1'));
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await createServer({ root, server: { port: 5630 + Math.floor(Math.random() * 60), strictPort: false, hmr: false }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`${server.resolvedUrls.local[0]}?test=1&god=1&nosound=1&phase=${phase}`);
await page.waitForFunction(() => window.__CO?.ready && window.__CO.state().flow === 'title', null, { timeout: 90000 });
await page.evaluate(() => window.__CO.begin());
await page.evaluate(() => window.__CO.skipIntro());
await page.waitForFunction(() => window.__CO.state().flow === 'fight' && window.__CO.state().golem.state === 'combat', null, { timeout: 20000 });
await page.evaluate(() => window.__CO.teleportPlayer(0, 16));
await sleep(1500);
if (what === 'stagger') {
  await page.evaluate(() => {
    const g = window.__game.golem;
    g.cancelAttack?.();
    g.startStagger();
  });
  await sleep(Number(opt('--wait', '2200')));
} else if (what === 'dead') {
  await page.evaluate(() => window.__CO.killGolem());
  await sleep(1500);
}
const joints = await page.evaluate(() => {
  const g = window.__game.golem;
  const out = { step: g.step, state: g.state };
  for (const b of ['hips', 'thigh_L', 'thigh_R', 'shin_L', 'shin_R', 'hand_L', 'hand_R', 'head']) {
    const i = g.rig.i(b);
    const v = new window.__game.cam.camera.position.constructor();
    g.rig.tailWorld(i, v);
    out[b] = [v.x, v.y, v.z].map((n) => Math.round(n * 10) / 10);
  }
  out.targets = g.targets.map((t) => ({ n: t.name, open: t.open, r: t.radius, p: [t.pos.x, t.pos.y, t.pos.z].map((n) => Math.round(n * 100) / 100) }));
  return out;
});
console.log(JSON.stringify(joints));
// freeze the simulation and take over the camera
await page.evaluate(() => {
  const g = window.__game;
  g.timeScale = 0;
  g.hud.setVisible(false);
  window.__probeCam = { pos: [0, 5, 20], look: [0, 4, 0], fov: 55 };
  g.cam.update = function () {
    const c = this.camera;
    const p = window.__probeCam;
    c.position.set(p.pos[0], p.pos[1], p.pos[2]);
    c.fov = p.fov;
    c.updateProjectionMatrix();
    c.lookAt(p.look[0], p.look[1], p.look[2]);
  };
});
const views = [
  ['front', 0, 18, 4],
  ['three_quarter', 0.8, 18, 5],
  ['side', 1.57, 18, 4],
  ['back_three_quarter', 2.4, 16, 5],
  ['back', 3.14, 14, 5],
];
for (const [name, a, r, h] of views) {
  await page.evaluate(({ a, r, h }) => {
    const g = window.__game.golem;
    const yaw = g.yaw + a;
    window.__probeCam = { pos: [g.pos.x + Math.sin(yaw) * r, h, g.pos.z + Math.cos(yaw) * r], look: [g.pos.x, 4.5, g.pos.z], fov: 55 };
  }, { a, r, h });
  await sleep(250);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
}
console.log(JSON.stringify({ what, outDir, errors }, null, 1));
await browser.close();
await server.close();
