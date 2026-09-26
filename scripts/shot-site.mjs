#!/usr/bin/env node
/**
 * Screenshots of the landing page at fixed scroll points, for review:
 *   node scripts/shot-site.mjs [url] [--width 1440 --height 900] [--out test-output/site-shots]
 * Uses the installed Chrome when there is one (Playwright's own Chromium cannot decode H.264 video).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => (args.indexOf(`--${k}`) >= 0 ? args[args.indexOf(`--${k}`) + 1] : d);
const url = args.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5791/';
const width = Number(opt('width', 1440));
const height = Number(opt('height', 900));
const out = path.resolve(root, opt('out', 'test-output/site-shots'));
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
} catch {
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
}
const page = await browser.newPage({ viewport: { width, height } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('requestfailed', (r) => errors.push(`failed ${r.url()}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
await sleep(1500);

const riseAt = async (p) => page.evaluate((p) => {
  const r = document.querySelector('.rise');
  window.scrollTo(0, (r.offsetHeight - innerHeight) * p);
}, p);
const toEl = async (sel, i = 0, off = 0) => page.evaluate(([sel, i, off]) => {
  const e = document.querySelectorAll(sel)[i];
  window.scrollTo(0, e.getBoundingClientRect().top + scrollY + off);
}, [sel, i, off]);
const shots = [
  ['01_hero_start', () => riseAt(0)],
  ['02_hero_mid', () => riseAt(0.45)],
  ['03_hero_end', () => riseAt(0.95)],
  ['04_rule', () => toEl('.rule', 0, -60)],
  ['05_step_strike', () => toEl('.step', 1, -height / 2 + 140)],
  ['06_step_phase3', () => toEl('.step', 6, -height / 2 + 140)],
  ['07_watch', () => toEl('.watch', 0, 40)],
  ['08_fallen', () => toEl('.fallen', 0, -40)],
  ['09_stages', () => toEl('.stages', 0, 40)],
  ['10_controls', () => toEl('.controls', 0, 40)],
  ['11_making', () => toEl('.making', 0, 40)],
  ['12_making_2', () => toEl('.making-grid', 0, -200)],
  ['13_last', () => toEl('.last', 0, -200)],
];
for (const [name, go] of shots) {
  await go();
  await sleep(1800);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
}
const info = await page.evaluate(() => ({
  videosPlaying: [...document.querySelectorAll('video')].filter((v) => !v.paused).length,
  canH264: document.createElement('video').canPlayType('video/mp4; codecs="avc1.640028"'),
  stepTimes: [...document.querySelectorAll('.step-time')].map((e) => e.textContent),
  tally: document.getElementById('tally').textContent,
  overflowX: document.documentElement.scrollWidth > innerWidth,
}));
console.log(JSON.stringify(info, null, 1));
console.log('errors:', errors.length ? errors.slice(0, 8) : 'none');
await browser.close();
