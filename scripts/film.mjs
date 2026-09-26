#!/usr/bin/env node
/**
 * Film mode: records the finished game as smooth 60 fps footage for the landing page and the README.
 *
 *   node scripts/film.mjs --shoot intro|fight|lose [--width 1920 --height 1080] [--out dir] [--nobuild] [--minutes 9]
 *
 * intro : the title screen, then the whole intro (the rubble rises into the golem), with no HUD
 * fight : the expert bot fights to the victory screen (god mode with a health floor, so the HUD shows real
 *         hits but never the low-health state), HUD on
 * lose  : a warrior who stands still until the golem kills them, then the FALLEN screen
 *
 * The page's clock is virtual: an init script replaces requestAnimationFrame and performance.now, and the
 * script advances the game one 1/60 s frame at a time, capturing each frame over CDP into ffmpeg (x264,
 * CRF 14). A 1080p capture runs well below real time, but the game never sees that, so the footage is a
 * smooth 60 fps. Every notable game event is saved with its frame number in film.json (marks), and
 * scripts/make-media.mjs cuts the clips at those marks, so a new recording re-cuts itself.
 *
 * Runs against the production build (vite build + preview); --nobuild reuses dist/.
 */
import { chromium } from 'playwright';
import { build, preview } from 'vite';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const shoot = opt('shoot', 'intro');
const width = Number(opt('width', 1920));
const height = Number(opt('height', 1080));
const outDir = path.resolve(root, opt('out', `test-output/film-${shoot}`));
fs.mkdirSync(outDir, { recursive: true });
const FPS = 60;
const t0 = Date.now();
const log = (...a) => console.log(`[film ${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

if (!flag('nobuild')) await build({ root, logLevel: 'warn' });
const server = await preview({ root, preview: { port: 4700 + Math.floor(Math.random() * 90), strictPort: false }, logLevel: 'warn' });
const baseUrl = server.resolvedUrls.local[0];

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

// Virtual clock: until __film.begin() the page runs normally; after it, requestAnimationFrame callbacks only
// run when the script calls __film.step(), and performance.now() only moves then.
await page.addInitScript((fps) => {
  const realRaf = window.requestAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  let manual = false;
  let now = 0;
  let queue = [];
  let nextId = 1;
  window.requestAnimationFrame = (cb) => {
    if (!manual) return realRaf(cb);
    const id = nextId++;
    queue.push({ id, cb });
    return id;
  };
  const realCancel = window.cancelAnimationFrame.bind(window);
  window.cancelAnimationFrame = (id) => {
    queue = queue.filter((q) => q.id !== id);
    realCancel(id);
  };
  performance.now = () => (manual ? now : realNow());
  window.__film = {
    begin() {
      now = realNow();
      manual = true;
    },
    step() {
      now += 1000 / fps;
      const run = queue;
      queue = [];
      for (const q of run) q.cb(now);
    },
  };
}, FPS);

const params = new URLSearchParams({ test: '1', nosound: '1', quality: 'high' });
if (shoot === 'fight') params.set('god', '1');
await page.goto(`${baseUrl}?${params}`);
await page.waitForFunction(() => window.__CO && window.__CO.ready && window.__CO.state().flow === 'title', null, { timeout: 120000 });
log('title reached at', `${width}x${height}`);
await page.evaluate(() => {
  window.__game.hud.showControls = false;
  window.__CO.drain();
});
if (shoot === 'intro') await page.addStyleTag({ content: '.hud { opacity: 0 !important; }' });
await new Promise((r) => setTimeout(r, 2500));

// ---------- capture
const cdp = await page.context().newCDPSession(page);
await cdp.send('Animation.enable');
await page.evaluate(() => window.__film.begin());
const enc = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(outDir, 'film.mp4')],
{ stdio: ['pipe', 'inherit', 'inherit'] });
const marks = [];
let frameN = 0;
const realStart = Date.now();
let lastJpeg = null;

/** One game frame: advance the virtual clock 1/60 s, render, capture, and record the events it raised. */
async function frame() {
  const evs = await page.evaluate(() => {
    window.__film.step();
    return window.__CO.drain();
  });
  for (const e of evs) marks.push({ label: e.type, info: e.info, frame: frameN, t: +(frameN / FPS).toFixed(3) });
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true });
  lastJpeg = Buffer.from(data, 'base64');
  if (!enc.stdin.write(lastJpeg)) await new Promise((r) => enc.stdin.once('drain', r));
  frameN++;
  // CSS animations (HUD pulses, screen fades) run on real time: slow them to the capture rate
  if (frameN % 60 === 0) {
    const rate = frameN / FPS / Math.max(0.001, (Date.now() - realStart) / 1000);
    await cdp.send('Animation.setPlaybackRate', { playbackRate: Math.min(1, rate) });
    if (frameN % 1800 === 0) log(`filmed ${frameN} frames (${(frameN / FPS).toFixed(0)} s), ${(rate * FPS).toFixed(1)} frames per real second`);
  }
}
const mark = (label, info) => marks.push({ label, info, frame: Math.max(0, frameN - 1), t: +(Math.max(0, frameN - 1) / FPS).toFixed(3) });
async function frames(seconds) {
  const n = Math.max(1, Math.round(seconds * FPS));
  for (let i = 0; i < n; i++) await frame();
}
/** Film frames until fn() is true in the page (checked every few frames) or the time runs out. */
async function until(fn, maxSeconds, every = 6) {
  const end = frameN + maxSeconds * FPS;
  while (frameN < end) {
    for (let i = 0; i < every; i++) await frame();
    if (await page.evaluate(fn)) return true;
  }
  return false;
}
const flow = () => page.evaluate(() => window.__CO.state().flow);

try {
  if (shoot === 'intro') {
    await frames(2.5);
    mark('title');
    await page.evaluate(() => window.__CO.begin());
    mark('begin');
    await until(() => window.__CO.state().flow === 'fight', 30);
    mark('fight');
    await frames(3);
  } else if (shoot === 'fight') {
    await page.evaluate(() => {
      window.__CO.begin();
      window.__CO.skipIntro();
      window.__CO.godFloor(46);
    });
    await until(() => window.__CO.state().flow === 'fight', 20);
    mark('fight');
    await page.evaluate(() => window.__CO.bot('expert', 7));
    const ok = await until(() => ['victoryCine', 'victory'].includes(window.__CO.state().flow), Number(opt('minutes', 9)) * 60, 30);
    if (!ok) log('warn: no victory within the time limit');
    mark('victoryCine');
    await until(() => window.__CO.state().flow === 'victory', 30);
    mark('victory_screen');
    await frames(5);
  } else if (shoot === 'lose') {
    await page.evaluate(() => {
      window.__CO.begin();
      window.__CO.skipIntro();
    });
    await until(() => window.__CO.state().flow === 'fight', 20);
    mark('fight');
    await until(() => window.__CO.state().flow === 'dead', 240, 30);
    mark('dead_screen');
    await frames(5);
  }
  if (lastJpeg) fs.writeFileSync(path.join(outDir, 'last.jpg'), lastJpeg);
} finally {
  enc.stdin.end();
  await new Promise((r) => enc.on('close', r));
  const state = await page.evaluate(() => window.__CO.state()).catch(() => null);
  fs.writeFileSync(path.join(outDir, 'film.json'), JSON.stringify({ shoot, fps: FPS, frames: frameN, width, height, flow: state?.flow, fightTime: state?.fightTime, player: state?.player?.stats, marks }, null, 1));
  log(`film.mp4: ${frameN} frames (${(frameN / FPS).toFixed(1)} s), ${marks.length} marks, flow ${state?.flow}, errors ${errors.length}`, errors.slice(0, 3));
  await browser.close();
  await server.close();
}
