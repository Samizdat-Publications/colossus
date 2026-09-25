#!/usr/bin/env node
/**
 * Diagnostics: force attacks and print where the cores are during each punish window.
 *   node scripts/probe.mjs [attacks=slam,sweep,doubleSlam,leap] [--shots dir]
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const attacks = (args.find((a) => !a.startsWith('--')) ?? 'slam,sweep,doubleSlam,leap,stagger').split(',');
const shotsIdx = args.indexOf('--shots');
const shotsDir = shotsIdx >= 0 ? path.resolve(root, args[shotsIdx + 1]) : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await createServer({ root, server: { port: 5719, strictPort: false }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${server.resolvedUrls.local[0]}?test=1&god=1`);
await page.waitForFunction(() => window.__CO?.ready && window.__CO.state().flow === 'title');
await page.evaluate(() => window.__CO.begin());
await page.evaluate(() => window.__CO.skipIntro());
await page.waitForFunction(() => window.__CO.state().flow === 'fight', null, { timeout: 20000 });

const fmt = (t) => `${t.name.padEnd(11)} y=${t.pos.y.toFixed(2).padStart(5)} xz=(${t.pos.x.toFixed(1)},${t.pos.z.toFixed(1)}) open=${t.open}`;
for (const a of attacks) {
  await page.evaluate(() => window.__CO.teleportPlayer(0, 9));
  await sleep(600);
  if (a === 'stagger') {
    await page.evaluate(() => {
      const g = window.__game.golem;
      g.breakMeter = 999;
      g.receiveSwordHit({ kind: 'core', core: g.targets[0], damage: 1, breakAmount: 999, heavy: false, charged: false, pos: g.targets[0].pos.clone(), normal: g.targets[0].pos.clone() });
    });
    await page.waitForFunction(() => window.__CO.state().golem.step === 'down', null, { timeout: 8000 });
  } else {
    await page.evaluate((name) => window.__CO.forceAttack(name, 'L'), a);
    await page.waitForFunction(() => ['stuck', 'rest'].includes(window.__CO.state().golem.step), null, { timeout: 12000 });
  }
  await sleep(400);
  const s = await page.evaluate(() => window.__CO.state());
  console.log(`\n== ${a} (${s.golem.step}) golem at (${s.golem.pos.x.toFixed(1)},${s.golem.pos.z.toFixed(1)}) player at (${s.player.pos.x.toFixed(1)},${s.player.pos.z.toFixed(1)})`);
  for (const t of s.golem.targets) console.log('  ', fmt(t));
  if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `${a}.png`) });
  await page.waitForFunction(() => !window.__CO.state().golem.attack && window.__CO.state().golem.state === 'combat', null, { timeout: 20000 }).catch(() => {});
}
await browser.close();
await server.close();
