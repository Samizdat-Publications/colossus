#!/usr/bin/env node
/**
 * Can the warrior actually hit the phase 3 heart while the golem is down? Staggers the golem in phase 3,
 * walks the warrior in front of the heart (locked on) and swings: light combo, then a heavy.
 *   node scripts/probe-heart.mjs
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
await page.goto(`${server.resolvedUrls.local[0]}?test=1&god=1&nosound=1&phase=3`);
await page.waitForFunction(() => window.__CO?.ready && window.__CO.state().flow === 'title', null, { timeout: 90000 });
await page.evaluate(() => window.__CO.begin());
await page.evaluate(() => window.__CO.skipIntro());
await page.waitForFunction(() => window.__CO.state().flow === 'fight' && window.__CO.state().golem.state === 'combat', null, { timeout: 20000 });
await page.evaluate(() => window.__CO.holdGolem(true));
await sleep(1000);
await page.evaluate(() => window.__game.golem.startStagger());
await sleep(3600);
const setup = await page.evaluate(() => {
  const g = window.__game;
  const heart = g.golem.targets.find((t) => t.kind === 'chest');
  // stand in front of the heart, facing it
  const dx = heart.pos.x - g.golem.pos.x;
  const dz = heart.pos.z - g.golem.pos.z;
  const l = Math.hypot(dx, dz) || 1;
  const px = heart.pos.x + (dx / l) * 1.2;
  const pz = heart.pos.z + (dz / l) * 1.2;
  g.player.pos.set(px, 0, pz);
  g.player.locked = true;
  return { heart: [heart.pos.x, heart.pos.y, heart.pos.z].map((n) => +n.toFixed(2)), open: heart.open, player: [px, pz].map((n) => +n.toFixed(2)) };
});
console.log('setup', JSON.stringify(setup));
await sleep(300);
const since = await page.evaluate(() => window.__CO.state().time);
const pos = await page.evaluate(() => [window.__game.player.pos.x, window.__game.player.pos.z].map((n) => +n.toFixed(2)));
console.log('player after settle', pos);
for (let i = 0; i < 3; i++) {
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
  await sleep(380);
}
await sleep(400);
await page.mouse.down({ button: 'right' });
await sleep(450);
await page.mouse.up({ button: 'right' });
await sleep(900);
const ev = await page.evaluate((t) => window.__CO.events(t).filter((e) => e.type === 'coreHit' || e.type === 'deflect'), since);
console.log('events', JSON.stringify(ev));
await browser.close();
await server.close();
