#!/usr/bin/env node
/**
 * The stone deflect at the golem's shin, as the feel critic sees it: which golem bones count as blocking the
 * camera's view of the warrior, how faded their pieces are, and a screenshot.
 *   node scripts/probe-deflect.mjs [--out dir]
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const outDir = path.resolve(root, opt('--out', 'test-output/probe-deflect'));
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await createServer({ root, server: { port: 5630 + Math.floor(Math.random() * 60), strictPort: false, hmr: false }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${server.resolvedUrls.local[0]}?test=1&god=1&nosound=1`);
await page.waitForFunction(() => window.__CO?.ready && window.__CO.state().flow === 'title', null, { timeout: 90000 });
await page.click('button[data-act="begin"]');
await page.evaluate(() => window.__CO.skipIntro());
await page.waitForFunction(() => window.__CO.state().flow === 'fight' && window.__CO.state().golem.state === 'combat', null, { timeout: 20000 });
await page.evaluate(() => {
  window.__CO.holdGolem(true);
  window.__game.hud.showControls = false;
});
await sleep(1500);
await page.keyboard.press('KeyQ');
for (const side of ['shin_L', 'shin_R']) {
  await page.evaluate((side) => {
    const game = window.__game;
    const g = game.golem;
    const shin = g.capsules.find((c) => c.name === side);
    const mx = (shin.a.x + shin.b.x) / 2;
    const mz = (shin.a.z + shin.b.z) / 2;
    let dx = mx - g.pos.x;
    let dz = mz - g.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    game.player.pos.set(mx + dx * (shin.r + 1.0), 0, mz + dz * (shin.r + 1.0));
    game.player.yaw = Math.atan2(-dx, -dz);
    game.player.locked = true;
  }, side);
  await sleep(700);
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
  await sleep(260);
  await page.evaluate(() => window.__CO.setTimeScale(0));
  await sleep(100);
  const info = await page.evaluate(() => {
    const game = window.__game;
    const blocked = [...game.blockedPivots].map((b) => b.name.replace('pivot_', ''));
    const fader = game.faderMerged ?? game.fader;
    const faded = fader.parts.filter((p) => p.opacity < 0.9).map((p) => `${p.mesh.parent?.name.replace('pivot_', '')}:${p.opacity.toFixed(2)}`);
    // what does a ray from the camera to the warrior's chest and knees pass through?
    const THREE = window.__THREE;
    const cam = game.cam.camera.position.clone();
    const hits = [];
    for (const h of [1.25, 0.5]) {
      const to = new THREE.Vector3(game.player.pos.x, game.player.y + h, game.player.pos.z);
      const dir = to.clone().sub(cam);
      const len = dir.length();
      const rc = new THREE.Raycaster(cam, dir.normalize(), 0, len - 0.6);
      rc.camera = game.cam.camera;
      for (const x of rc.intersectObjects(game.scene.children, true)) {
        if (!x.object.visible || x.object.isPoints || x.object.isSprite) continue;
        const m = x.object.material;
        hits.push(`${h}:${x.object.name || x.object.type}<${x.object.parent?.name ?? ''}>@${x.distance.toFixed(1)} op=${(m.opacity ?? 1).toFixed(2)} tr=${!!m.transparent}`);
        if (hits.length > 12) break;
      }
    }
    return { blocked, faded: faded.slice(0, 20), state: game.player.state, locked: game.player.locked, cam: cam.toArray().map((v) => +v.toFixed(1)), hits };
  });
  console.log(side, JSON.stringify(info));
  await page.screenshot({ path: path.join(outDir, `deflect_${side}.png`) });
  await page.evaluate(() => window.__CO.setTimeScale(1));
  await sleep(600);
}
await browser.close();
await server.close();
