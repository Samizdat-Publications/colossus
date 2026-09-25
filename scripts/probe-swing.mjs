#!/usr/bin/env node
/** Diagnostics: during a slam's stuck window, stand next to the arm core and swing. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = await createServer({ root, server: { port: 5729, strictPort: false, hmr: false }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${server.resolvedUrls.local[0]}?test=1&god=1`);
await page.waitForFunction(() => window.__CO?.ready && window.__CO.state().flow === 'title');
await page.evaluate(() => window.__CO.begin());
await page.evaluate(() => window.__CO.skipIntro());
await page.waitForFunction(() => window.__CO.state().flow === 'fight', null, { timeout: 20000 });

for (const [dist, label] of [
  [1.2, 'touching'],
  [2.0, 'close'],
  [3.0, 'mid'],
  [3.6, 'far'],
]) {
  await page.evaluate(() => window.__CO.teleportPlayer(0, 9));
  await sleep(300);
  await page.evaluate(() => window.__CO.forceAttack('slam', 'L'));
  await page.waitForFunction(() => window.__CO.state().golem.step === 'stuck', null, { timeout: 12000 });
  await sleep(200);
  const res = await page.evaluate((d) => {
    const g = window.__game.golem;
    const p = window.__game.player;
    const core = g.targets.find((t) => t.name === 'core_arm_L');
    // stand d metres from the core on the side facing away from the golem, face it
    const dx = core.pos.x - g.pos.x;
    const dz = core.pos.z - g.pos.z;
    const l = Math.hypot(dx, dz);
    p.pos.set(core.pos.x + (dx / l) * d, 0, core.pos.z + (dz / l) * d);
    p.yaw = Math.atan2(core.pos.x - p.pos.x, core.pos.z - p.pos.z);
    p.state = 'move';
    p.stateTime = 0;
    p.knockVel.set(0, 0, 0);
    p.vel.set(0, 0, 0);
    p.anim.seq = null;
    return { core: core.pos.toArray().map((v) => +v.toFixed(2)), player: p.pos.toArray().map((v) => +v.toFixed(2)) };
  }, dist);
  const before = await page.evaluate(() => ({ ...window.__game.player.stats }));
  for (let i = 0; i < 3; i++) {
    await page.mouse.down();
    await sleep(60);
    await page.mouse.up();
    await sleep(520);
  }
  const after = await page.evaluate(() => ({ ...window.__game.player.stats }));
  const ev = await page.evaluate(() => window.__CO.events().slice(-8));
  console.log(label, JSON.stringify(res), 'coreHits', after.coreHits - before.coreHits, 'deflects', after.deflects - before.deflects, JSON.stringify(ev.map((e) => e.type)));
  await page.waitForFunction(() => !window.__CO.state().golem.attack, null, { timeout: 15000 }).catch(() => {});
}
await browser.close();
await server.close();
