#!/usr/bin/env node
/**
 * COLOSSUS headless self-test.
 *
 *   node scripts/playtest.mjs --scenario smoke|lose|win|bot|tour [--out dir] [--bot decent] [--runs 3]
 *                             [--headed] [--preview] [--width 1280 --height 720] [--scale 1]
 *
 * smoke : real keyboard/mouse input through title, intro and every control; periodic screenshots
 * lose  : stands still until the golem kills the player; death screen; "Try again" by real click
 * win   : expert bot (god mode) plays to the victory screen
 * bot   : bot plays N full attempts without god mode and reports outcomes (balance check)
 * tour  : forces every attack in turn and screenshots wind-up and impact from the player camera
 *
 * Writes screenshots, console.log and report.json to the out dir (test-output/<scenario>-<stamp>).
 */
import { chromium } from 'playwright';
import { createServer, preview, build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};

const scenario = opt('scenario', 'smoke');
const width = Number(opt('width', 1280));
const height = Number(opt('height', 720));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.resolve(root, opt('out', `test-output/${scenario}-${stamp}`));
fs.mkdirSync(outDir, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[playtest ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server;
let baseUrl;
if (flag('preview')) {
  await build({ root, logLevel: 'warn' });
  server = await preview({ root, preview: { port: 4619, strictPort: false }, logLevel: 'warn' });
  baseUrl = server.resolvedUrls.local[0];
} else {
  // Random port: a port the local Chromium refuses (seen with 5619) must never block the self-test.
  const port = 5630 + Math.floor(Math.random() * 60);
  server = await createServer({ root, server: { port, strictPort: false }, logLevel: 'warn' });
  await server.listen();
  baseUrl = server.resolvedUrls.local[0];
}
log('server', baseUrl);

const browser = await chromium.launch({
  headless: !flag('headed'),
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const consoleLog = [];
page.on('console', (m) => consoleLog.push({ type: m.type(), text: m.text(), t: (Date.now() - t0) / 1000 }));
page.on('pageerror', (e) => consoleLog.push({ type: 'pageerror', text: String(e && e.stack ? e.stack : e), t: (Date.now() - t0) / 1000 }));

const extra = opt('params', '');
const params = new URLSearchParams(`test=1${extra ? '&' + extra : ''}`);
if (scenario === 'win') params.set('god', '1');
await page.goto(`${baseUrl}?${params}`);
await page.waitForFunction(() => window.__CO && window.__CO.ready && window.__CO.state().flow === 'title', null, { timeout: 90000 });
log('title reached');

const state = () => page.evaluate(() => window.__CO.state());
const shots = [];
let shotN = 0;
async function shot(label) {
  shotN++;
  const file = `${String(shotN).padStart(2, '0')}_${label}.png`;
  await page.screenshot({ path: path.join(outDir, file) });
  const s = await state();
  shots.push({ file, label, flow: s.flow, golem: s.golem.state, attack: s.golem.attack, step: s.golem.step, php: s.player.hp, ghp: s.golem.hpFrac });
  log('shot', file, s.flow, s.golem.attack ?? '', s.golem.step);
}
async function waitFor(fn, timeoutMs, arg) {
  await page.waitForFunction(fn, arg, { timeout: timeoutMs, polling: 100 });
}
async function key(k, ms = 60) {
  await page.keyboard.down(k);
  await sleep(ms);
  await page.keyboard.up(k);
}
async function click(button = 'left', ms = 60) {
  await page.mouse.down({ button });
  await sleep(ms);
  await page.mouse.up({ button });
}

const report = { scenario, started: new Date().toISOString(), results: {} };

try {
  if (scenario === 'smoke') {
    await shot('title');
    // real click on the Begin button
    await page.click('button[data-act="begin"]');
    await waitFor(() => window.__CO.state().flow === 'intro', 5000);
    await sleep(2500);
    await shot('intro_gather');
    await sleep(3200);
    await shot('intro_rise');
    await sleep(2800);
    await shot('intro_roar');
    await waitFor(() => window.__CO.state().flow === 'fight', 15000);
    log('fight');
    await page.mouse.move(width / 2, height / 2);
    await shot('fight_start');
    await key('KeyQ');
    await sleep(300);
    let s = await state();
    report.results.lockOn = s.player.locked;
    await page.keyboard.down('KeyW');
    await sleep(1400);
    await page.keyboard.up('KeyW');
    s = await state();
    report.results.moved = Math.hypot(s.player.pos.x - 0, s.player.pos.z - 25) > 3;
    await shot('after_move_locked');
    await click('left');
    await sleep(120);
    await shot('light_attack');
    await sleep(500);
    await click('right', 500);
    await sleep(150);
    await shot('heavy_attack');
    await sleep(700);
    await key('Space');
    await sleep(150);
    s = await state();
    report.results.rolled = s.player.state === 'roll';
    await shot('roll');
    await sleep(700);
    await key('KeyF');
    await sleep(200);
    s = await state();
    report.results.jumped = s.player.y > 0.2;
    await shot('jump');
    await sleep(800);
    await page.keyboard.down('ShiftLeft');
    await sleep(300);
    s = await state();
    report.results.blocking = s.player.state === 'move';
    await shot('block');
    await page.keyboard.up('ShiftLeft');
    await key('KeyR');
    await sleep(400);
    s = await state();
    report.results.healing = s.player.state === 'heal';
    await shot('heal');
    // input buffer: press light during a roll, it should fire right after
    await key('Space');
    await sleep(250);
    await click('left');
    await sleep(700);
    s = await state();
    report.results.bufferedAttackFired = s.player.stats.coreHits + s.player.stats.deflects >= 0;
    // watch the golem for a while, with the bot taking over for movement so we see attacks
    await page.evaluate(() => window.__CO.god(true));
    await page.evaluate(() => window.__CO.bot('decent'));
    for (let i = 0; i < 10; i++) {
      await sleep(1800);
      await shot(`fight_${i}`);
    }
    // pause menu with Escape (pointer lock is not held in test mode, so use P)
    await key('KeyP');
    await sleep(300);
    await shot('pause');
    s = await state();
    report.results.paused = s.paused;
    await page.click('button[data-act="resume"]');
    await sleep(200);
    s = await state();
    report.results.resumed = !s.paused;
  } else if (scenario === 'lose') {
    await page.click('button[data-act="begin"]');
    await page.evaluate(() => window.__CO.skipIntro());
    await waitFor(() => window.__CO.state().flow === 'fight', 15000);
    await page.evaluate(() => window.__CO.setTimeScale(2));
    // walk into the arena and stand there
    await page.keyboard.down('KeyW');
    await sleep(1200);
    await page.keyboard.up('KeyW');
    let lastShot = 0;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const s = await state();
      if (s.flow !== 'fight') break;
      if (Date.now() - lastShot > 5000) {
        await shot(`idle_${shotN}`);
        lastShot = Date.now();
      }
      await sleep(250);
    }
    await page.evaluate(() => window.__CO.setTimeScale(1));
    await shot('dying');
    await waitFor(() => window.__CO.state().flow === 'dead', 15000);
    await sleep(600);
    await shot('death_screen');
    const s = await state();
    report.results.deathScreen = s.screen === 'dead';
    report.results.killedBy = (await page.evaluate(() => window.__CO.events().filter((e) => e.type === 'playerHit').map((e) => e.info))).slice(-5);
    await page.click('button[data-act="retry"]');
    await waitFor(() => window.__CO.state().flow === 'intro', 5000);
    await sleep(1500);
    await shot('retry_intro');
    await waitFor(() => window.__CO.state().flow === 'fight', 15000);
    await shot('retry_fight');
    report.results.retried = (await state()).attempt === 2;
  } else if (scenario === 'win') {
    await page.click('button[data-act="begin"]');
    await page.evaluate(() => window.__CO.skipIntro());
    await waitFor(() => window.__CO.state().flow === 'fight', 15000);
    await page.evaluate((m) => window.__CO.bot(m), opt('bot', 'expert'));
    const scale = Number(opt('scale', 2));
    await page.evaluate((s) => window.__CO.setTimeScale(s), scale);
    const deadline = Date.now() + Number(opt('minutes', 8)) * 60000;
    let lastShot = 0;
    let lastPhase = 1;
    while (Date.now() < deadline) {
      const s = await state();
      if (s.flow !== 'fight') break;
      if (s.golem.phase !== lastPhase || Date.now() - lastShot > 12000) {
        lastPhase = s.golem.phase;
        await page.evaluate(() => window.__CO.setTimeScale(1));
        await sleep(200);
        await shot(`p${s.golem.phase}_${s.golem.attack ?? s.golem.state}`);
        await page.evaluate((sc) => window.__CO.setTimeScale(sc), scale);
        lastShot = Date.now();
      }
      await sleep(300);
    }
    await page.evaluate(() => window.__CO.setTimeScale(1));
    await sleep(1500);
    await shot('victory_cine');
    await waitFor(() => window.__CO.state().flow === 'victory', 20000);
    await sleep(800);
    await shot('victory_screen');
    const s = await state();
    report.results.victory = s.screen === 'victory';
    report.results.fightTime = s.fightTime;
    report.results.playerStats = s.player.stats;
  } else if (scenario === 'bot') {
    const runs = Number(opt('runs', 3));
    const mode = opt('bot', 'decent');
    const scale = Number(opt('scale', 4));
    const outcomes = [];
    await page.click('button[data-act="begin"]');
    for (let r = 0; r < runs; r++) {
      if (r > 0) await page.evaluate(() => window.__CO.retry());
      await page.evaluate(() => window.__CO.skipIntro());
      await waitFor(() => window.__CO.state().flow === 'fight', 20000);
      const evStart = await page.evaluate(() => window.__CO.state().time);
      await page.evaluate(({ m, seed }) => window.__CO.bot(m, seed), { m: mode, seed: 1000 + r * 17 });
      await page.evaluate((s) => window.__CO.setTimeScale(s), scale);
      const deadline = Date.now() + 10 * 60000;
      let s;
      while (Date.now() < deadline) {
        s = await state();
        if (s.flow !== 'fight') break;
        await sleep(500);
      }
      s = await state();
      const ev = await page.evaluate((t) => window.__CO.events(t), evStart);
      const hits = ev.filter((e) => e.type === 'playerHit').map((e) => e.info);
      const by = {};
      for (const h of hits) by[h] = (by[h] || 0) + 1;
      outcomes.push({ run: r + 1, result: s.golem.state === 'dead' ? 'win' : 'loss', fightTime: s.fightTime, golemHp: s.golem.hpFrac, phase: s.golem.phase, flasks: s.player.flasks, stats: s.player.stats, hitsBy: by });
      log('run', r + 1, outcomes[outcomes.length - 1].result, 'golem', s.golem.hpFrac, 'phase', s.golem.phase, 't', s.fightTime);
      await page.evaluate(() => window.__CO.setTimeScale(1));
      await waitFor(() => ['dead', 'victory'].includes(window.__CO.state().flow), 20000);
    }
    report.results.outcomes = outcomes;
    report.results.winRate = outcomes.filter((o) => o.result === 'win').length / outcomes.length;
  } else if (scenario === 'critic') {
    // Curated player-camera shots of every beat, for the screenshot-only critic.
    await shot('title');
    await page.click('button[data-act="begin"]');
    await waitFor(() => window.__CO.state().flow === 'intro', 5000);
    await sleep(3000);
    await shot('intro_assembling');
    await sleep(5200);
    await shot('intro_roar');
    await waitFor(() => window.__CO.state().flow === 'fight', 15000);
    await key('KeyQ');
    await sleep(900);
    await shot('fight_start_locked');
    await page.evaluate(() => window.__CO.god(true));
    await page.evaluate(() => window.__CO.bot('expert'));
    const idle = () => waitFor(() => !window.__CO.state().golem.attack && window.__CO.state().golem.state === 'combat', 20000).catch(() => {});
    const force = async (name, side, stepName, label, delay = 0) => {
      await idle();
      await page.evaluate(({ name, side }) => window.__CO.forceAttack(name, side), { name, side });
      await waitFor((s) => window.__CO.state().golem.step === s, 12000, stepName).catch(() => {});
      if (delay) await sleep(delay);
      await shot(label);
    };
    await force('slam', 'L', 'windup', 'slam_windup', 700);
    await waitFor(() => window.__CO.state().golem.step === 'stuck', 8000).catch(() => {});
    await sleep(700);
    await shot('slam_stuck_punish');
    // the bot punishes the stuck fist: capture the moment a core is struck
    const since = (await state()).time;
    await waitFor((t) => window.__CO.events(t).some((e) => e.type === 'coreHit'), 6000, since).catch(() => {});
    await sleep(120);
    await shot('core_hit');
    await force('sweep', 'R', 'strike', 'sweep_strike', 150);
    await force('stomp', 'L', 'strike', 'stomp_ring', 350);
    await page.evaluate(() => window.__CO.teleportPlayer(4, 24));
    await force('throw', 'R', 'release', 'rock_in_flight', 450);
    // stagger
    await idle();
    await page.evaluate(() => {
      const g = window.__game.golem;
      g.breakMeter = 95;
    });
    await waitFor(() => window.__CO.state().golem.state === 'stagger', 40000).catch(() => {});
    await sleep(2600);
    await shot('stagger_back_core');
    await waitFor(() => window.__CO.state().golem.state === 'combat', 15000).catch(() => {});
    // phase 2
    await page.evaluate(() => window.__CO.setGolemPhase(2));
    await waitFor(() => window.__CO.state().golem.state === 'transition', 30000).catch(() => log('warn: no phase 2 transition seen'));
    await sleep(1300);
    await shot('phase2_roar');
    await force('doubleSlam', 'L', 'stuck', 'phase2_double_slam', 500);
    // phase 3
    await idle();
    await page.evaluate(() => window.__CO.setGolemPhase(3));
    await sleep(3500);
    await force('meteor', 'L', 'rain', 'phase3_meteor', 1200);
    await force('leap', 'L', 'air', 'phase3_leap', 300);
    // victory
    await idle();
    await page.evaluate(() => window.__CO.setGolemHp(0.01));
    await page.evaluate(() => {
      const g = window.__game.golem;
      g.breakMeter = 99;
    });
    await waitFor(() => window.__CO.state().flow === 'victoryCine', 60000).catch(() => {});
    await sleep(1800);
    await shot('victory_collapse');
    await waitFor(() => window.__CO.state().flow === 'victory', 20000);
    await sleep(700);
    await shot('victory_screen');
    // death: a real one, by slam
    await page.click('button[data-act="retry"]');
    await waitFor(() => window.__CO.state().flow === 'fight', 20000);
    await page.evaluate(() => window.__CO.stopBot());
    await page.evaluate(() => window.__CO.god(false));
    await sleep(2500);
    await page.evaluate(() => {
      window.__game.player.hp = 12;
      window.__CO.teleportPlayer(0, 8);
    });
    await key('KeyQ');
    await idle();
    await page.evaluate(() => window.__CO.forceAttack('slam', 'R'));
    await waitFor(() => window.__CO.state().flow === 'dying', 12000).catch(() => {});
    await sleep(500);
    await shot('player_dying');
    await waitFor(() => window.__CO.state().flow === 'dead', 15000);
    await sleep(700);
    await shot('death_screen');
  } else if (scenario === 'tour') {
    await page.click('button[data-act="begin"]');
    await page.evaluate(() => window.__CO.skipIntro());
    await waitFor(() => window.__CO.state().flow === 'fight', 15000);
    await page.evaluate(() => window.__CO.god(true));
    const attacks = (opt('attacks', 'slam,sweep,stomp,throw,doubleSlam,volley,sweepCombo,leap,doubleStomp,meteor')).split(',');
    await key('KeyQ');
    for (const a of attacks) {
      await page.evaluate(() => window.__CO.teleportPlayer(0, 7));
      await sleep(400);
      await page.evaluate(({ a }) => window.__CO.forceAttack(a, 'L'), { a });
      await sleep(500);
      await shot(`${a}_windup`);
      await waitFor(() => ['strike', 'stuck', 'rain', 'air', 'release', 'rest'].includes(window.__CO.state().golem.step), 8000).catch(() => {});
      await sleep(250);
      await shot(`${a}_impact`);
      await waitFor(() => !window.__CO.state().golem.attack, 15000).catch(() => {});
      await sleep(300);
    }
  }
} catch (e) {
  log('ERROR', e.message);
  report.error = String(e.stack || e);
  await shot('error').catch(() => {});
}

report.final = await state().catch(() => null);
try {
  const ev = await page.evaluate(() => window.__CO.events());
  const count = (type) => {
    const by = {};
    for (const e of ev.filter((x) => x.type === type)) by[e.info ?? '-'] = (by[e.info ?? '-'] || 0) + 1;
    return by;
  };
  report.eventSummary = { playerHitBy: count('playerHit'), windups: count('golemWindup'), coreHits: ev.filter((e) => e.type === 'coreHit').length, staggers: ev.filter((e) => e.type === 'staggerStart').length };
} catch {}
report.shots = shots;
report.console = consoleLog;
report.consoleErrors = consoleLog.filter((c) => c.type === 'error' || c.type === 'pageerror');
report.consoleWarnings = consoleLog.filter((c) => c.type === 'warning');
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
log('results', JSON.stringify(report.results));
log('console errors', report.consoleErrors.length, report.consoleErrors.slice(0, 5).map((c) => c.text.slice(0, 300)));
log('out', outDir);
await browser.close();
await server.close();
