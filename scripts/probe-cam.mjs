#!/usr/bin/env node
/**
 * Diagnostics: force an attack with the warrior locked on and log the lock-on framing solve every
 * 150 ms (camera height and distance, FOV, pitch, where the golem's head and the warrior's feet land
 * on screen). Optional screenshots.
 *   node scripts/probe-cam.mjs [attack=leap] [--phase 3] [--at x,z] [--shots dir]
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const attack = args.find((a) => !a.startsWith('--') && !/^[\d.,-]+$/.test(a)) ?? 'leap';
const opt = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const phase = Number(opt('--phase', '3'));
const at = opt('--at', '0,12').split(',').map(Number);
const shotsDir = opt('--shots', null) ? path.resolve(root, opt('--shots')) : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await createServer({ root, server: { port: 5630 + Math.floor(Math.random() * 60), strictPort: false }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${server.resolvedUrls.local[0]}?test=1&god=1&phase=${phase}&nosound=1`);
await page.waitForFunction(() => window.__CO?.ready && window.__CO.state().flow === 'title', null, { timeout: 90000 });
await page.evaluate(() => window.__CO.begin());
await page.evaluate(() => window.__CO.skipIntro());
await page.waitForFunction(() => window.__CO.state().flow === 'fight' && window.__CO.state().golem.state === 'combat', null, { timeout: 20000 });
await page.evaluate(([x, z]) => window.__CO.teleportPlayer(x, z), at);
await page.evaluate(() => { window.__game.player.locked = true; });
await sleep(1500);
await page.waitForFunction(() => !window.__CO.state().golem.attack && window.__CO.state().golem.state === 'combat', null, { timeout: 20000 }).catch(() => {});
await page.evaluate((a) => window.__CO.forceAttack(a, 'L'), attack);
let n = 0;
for (let i = 0; i < 40; i++) {
  const s = await page.evaluate(() => {
    const g = window.__game;
    const cam = g.cam;
    const c = cam.camera;
    const head = g.golem.capsules.find((k) => k.name === 'head');
    const p = g.player.pos;
    const proj = (v) => {
      const q = v.clone().project(c);
      return [Math.round(((q.x + 1) / 2) * 1280), Math.round(((1 - q.y) / 2) * 720)];
    };
    const top = head.b.clone();
    top.y += head.r * 0.6;
    const feet = p.clone();
    return {
      step: g.golem.step,
      gy: g.golem.pos.y.toFixed(2),
      gd: Math.hypot(g.golem.pos.x - p.x, g.golem.pos.z - p.z).toFixed(1),
      camH: c.position.y.toFixed(2),
      camD: Math.hypot(c.position.x - p.x, c.position.z - p.z).toFixed(1),
      fov: c.fov.toFixed(1),
      pitch: (cam.lockPitch * 57.3).toFixed(1),
      pull: cam.pullBack.toFixed(2),
      wide: cam.wideNow.toFixed(2),
      rise: cam.riseNow.toFixed(2),
      tops: cam.topParts ? cam.topParts.size : 0,
      must: cam.mustSee.length,
      headPx: proj(top),
      feetPx: proj(feet),
    };
  });
  if (!s.step) break;
  console.log(JSON.stringify(s));
  if (shotsDir && s.step === 'air' && n < 4) await page.screenshot({ path: path.join(shotsDir, `${attack}_${n++}.png`) });
  await sleep(150);
}
await browser.close();
await server.close();
