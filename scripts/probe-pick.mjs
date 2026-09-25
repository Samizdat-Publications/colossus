#!/usr/bin/env node
/**
 * What is at a screen pixel on the title screen? Raycasts from the camera through the given pixels
 * and prints the first objects hit.   node scripts/probe-pick.mjs 430,12 720,20
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pts = process.argv.slice(2).map((s) => s.split(',').map(Number));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = await createServer({ root, server: { port: 5630 + Math.floor(Math.random() * 60), strictPort: false, hmr: false }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${server.resolvedUrls.local[0]}?test=1&nosound=1`);
await page.waitForFunction(() => window.__CO?.ready && window.__CO.state().flow === 'title', null, { timeout: 90000 });
await sleep(1500);
await page.screenshot({ path: path.join(root, 'test-output', 'pick.png') });
const out = await page.evaluate((pts) => {
  const g = window.__game;
  const cam = g.cam.camera;
  const THREE_ = { Raycaster: g.scene.constructor };
  void THREE_;
  const res = [];
  for (const [x, y] of pts) {
    const ndc = { x: (x / innerWidth) * 2 - 1, y: -(y / innerHeight) * 2 + 1 };
    // build a ray by hand (no THREE import in the page scope)
    const o = cam.position.clone();
    const d = cam.position.clone().set(ndc.x, ndc.y, 0.5).unproject(cam).sub(o).normalize();
    const hits = [];
    g.scene.traverseVisible((obj) => {
      if (!obj.isMesh || !obj.geometry) return;
      obj.geometry.computeBoundingSphere?.();
      const bs = obj.geometry.boundingSphere;
      if (!bs) return;
      const c = bs.center.clone().applyMatrix4(obj.matrixWorld);
      const s = obj.matrixWorld.getMaxScaleOnAxis();
      const r = bs.radius * s;
      const oc = c.clone().sub(o);
      const t = oc.dot(d);
      if (t < 0) return;
      const dist2 = oc.lengthSq() - t * t;
      if (dist2 <= r * r) {
        const wp = new cam.position.constructor();
        obj.getWorldPosition(wp);
        hits.push({ name: obj.name || obj.parent?.name || '(unnamed)', parent: obj.parent?.name, t: +t.toFixed(1), r: +r.toFixed(1), y: +wp.y.toFixed(1) });
      }
    });
    hits.sort((a, b) => a.t - b.t);
    res.push({ x, y, hits: hits.slice(0, 6) });
  }
  return res;
}, pts);
console.log(JSON.stringify(out, null, 1));
await browser.close();
await server.close();
