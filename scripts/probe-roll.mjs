#!/usr/bin/env node
/**
 * Dodge roll check: runs real rolls at a tenth of normal speed, samples the warrior mesh's lowest point
 * (world y, sword and cape excluded) every frame, and freezes the game for screenshots at fixed points
 * of the roll. `node scripts/probe-roll.mjs [--dir side|back] [--out dir]`
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const dir = opt('--dir', 'side');
const outDir = path.resolve(root, opt('--out', `test-output/probe-roll-${dir}`));
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await createServer({ root, server: { port: 5630 + Math.floor(Math.random() * 60), strictPort: false, hmr: false }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`${server.resolvedUrls.local[0]}?test=1&god=1&nosound=1`);
await page.waitForFunction(() => window.__CO?.ready && window.__CO.state().flow === 'title', null, { timeout: 90000 });
await page.evaluate(() => window.__CO.begin());
await page.evaluate(() => window.__CO.skipIntro());
await page.waitForFunction(() => window.__CO.state().flow === 'fight' && window.__CO.state().golem.state === 'combat', null, { timeout: 20000 });
await page.evaluate(() => {
  window.__CO.holdGolem(true);
  window.__CO.teleportPlayer(0, 17);
});
await sleep(2500);

// In-page helpers: lowest mesh point of the warrior (world y, relative to its ground), and a roll trigger.
await page.evaluate((dir) => {
  const THREE = window.__THREE;
  const p = window.__game.player;
  const v = new THREE.Vector3();
  window.__lowest = () => {
    p.rig.root.updateMatrixWorld(true);
    let min = Infinity;
    let who = '';
    p.rig.root.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      let n = o;
      let skip = false;
      while (n) {
        if (/sword|cape|flask/i.test(n.name)) skip = true;
        n = n.parent;
      }
      if (skip) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 2) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        if (v.y < min) {
          min = v.y;
          who = o.name;
        }
      }
    });
    return { min: min - p.rig.root.position.y, who };
  };
  window.__roll = () => {
    const cam = window.__game.cam.camera;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    right.y = 0;
    right.normalize();
    if (dir === 'side') {
      p.moveWish.copy(right);
      p.moveMag = 1;
    } else p.moveMag = 0;
    p.stamina = 100;
    return p.startRoll();
  };
}, dir);

// Pass 1: sample every frame through a slowed roll.
const samples = await page.evaluate(async () => {
  const p = window.__game.player;
  window.__CO.setTimeScale(0.1);
  window.__roll();
  const out = [];
  await new Promise((resolve) => {
    const tick = () => {
      const s = p.anim.seq;
      if (!s || s.done || p.state !== 'roll') return resolve();
      const t = s.progress;
      const l = window.__lowest();
      out.push({ t: Math.round(t * 1000) / 1000, min: Math.round(l.min * 1000) / 1000, who: l.who });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  window.__CO.setTimeScale(1);
  return out;
});
const worst = samples.reduce((a, b) => (b.min < a.min ? b : a), samples[0] ?? { min: NaN });
console.log(`samples ${samples.length}, lowest ${worst?.min} m at t=${worst?.t} (${worst?.who})`);
for (let k = 0; k < samples.length; k += Math.max(1, Math.floor(samples.length / 24))) console.log(`  t=${samples[k].t.toFixed(3)} min=${samples[k].min.toFixed(3)} ${samples[k].who}`);
fs.writeFileSync(path.join(outDir, 'samples.json'), JSON.stringify(samples));

// Pass 2: freeze at fixed points of the roll and take screenshots.
await sleep(1500);
for (const at of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]) {
  await page.evaluate(() => window.__game.player.pos.set(0, 0, 17));
  await sleep(900);
  await page.evaluate(async (at) => {
    const p = window.__game.player;
    window.__CO.setTimeScale(0.1);
    window.__roll();
    await new Promise((resolve) => {
      const tick = () => {
        const s = p.anim.seq;
        if (!s || s.done || s.progress >= at) {
          window.__CO.setTimeScale(0);
          return resolve();
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, at);
  await sleep(120);
  await page.screenshot({ path: path.join(outDir, `roll_${String(Math.round(at * 100)).padStart(2, '0')}.png`) });
  await page.evaluate(() => window.__CO.setTimeScale(1));
  await sleep(1200);
}
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
await server.close();
