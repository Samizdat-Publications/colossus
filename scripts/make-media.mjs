#!/usr/bin/env node
/**
 * Cuts the filmed runs (scripts/film.mjs) into the landing page's media and the README's GIFs.
 *
 *   node scripts/film.mjs --shoot intro
 *   node scripts/film.mjs --shoot fight --nobuild
 *   node scripts/film.mjs --shoot lose --nobuild
 *   node scripts/make-media.mjs
 *
 * Writes site/media/ (hero scrub frames, MP4 clips with posters, the whole fight, chapters.json, the
 * greybox-to-final stills, milestone stills, the share image) and docs/media/ (README GIFs).
 * Every clip is placed by an event mark in the run's film.json, so a new recording re-cuts itself.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'site/media');
const gifs = path.join(root, 'docs/media');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(gifs, { recursive: true });
const ff = (args) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const mb = (f) => (fs.statSync(f).size / 1e6).toFixed(2);
const x264 = (crf) => ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an'];

function run(name) {
  const dir = path.join(root, `test-output/film-${name}`);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'film.json'), 'utf8'));
  const dur = meta.frames / meta.fps;
  /** time of the n-th mark with this label (and info prefix), optionally after time `after` */
  const at = (label, { info, after = 0, nth = 0, last = false } = {}) => {
    const ms = meta.marks.filter((m) => m.label === label && m.t >= after && (!info || String(m.info ?? '').startsWith(info)));
    const m = last ? ms[ms.length - 1] : ms[nth];
    if (!m) throw new Error(`film-${name}: no mark ${label}${info ? ` (${info})` : ''} after ${after}`);
    return m.t;
  };
  return { file: path.join(dir, 'film.mp4'), meta, dur, at };
}

const intro = run('intro');
const fight = run('fight');
const lose = run('lose');

// ---------------------------------------------------------------- hero: the rubble rises, frame by frame
// The page scrubs these with the scroll position.
{
  const dir = path.join(out, 'rise');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const from = intro.at('begin') + 0.2;
  const to = intro.at('roar') + 1.6;
  const N = 96;
  const fps = N / (to - from);
  ff(['-ss', from.toFixed(3), '-t', (to - from).toFixed(3), '-i', intro.file, '-vf', `fps=${fps.toFixed(4)},scale=1280:-2:flags=lanczos`, '-frames:v', String(N), '-q:v', '6', path.join(dir, 'f%02d.jpg')]);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort();
  // renumber from 00
  files.forEach((f, i) => fs.renameSync(path.join(dir, f), path.join(dir, `r${String(i).padStart(2, '0')}.jpg`)));
  const total = fs.readdirSync(dir).reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0);
  fs.writeFileSync(path.join(out, 'rise.json'), JSON.stringify({ frames: files.length }));
  console.log(`hero scrub: ${files.length} frames, ${(total / 1e6).toFixed(1)} MB`);
  // the first and last frames double as posters (the first also as the page's first paint)
  fs.copyFileSync(path.join(dir, 'r00.jpg'), path.join(out, 'rise-first.jpg'));
  fs.copyFileSync(path.join(dir, `r${String(files.length - 1).padStart(2, '0')}.jpg`), path.join(out, 'rise-last.jpg'));
}

// ---------------------------------------------------------------- clips
// name, run, start (s), duration (s), poster offset (s from start)
const p2 = fight.at('phaseChange', { info: '2' });
const p3 = fight.at('phaseChange', { info: '3' });
const stag = fight.at('staggerStart');
const CLIPS = [
  { name: 'deflect', r: fight, start: fight.at('deflect') - 1.4, dur: 4.6, poster: 1.5 },
  { name: 'strike', r: fight, start: fight.at('coreHit', { info: 'core_arm' }) - 3.2, dur: 6, poster: 3.25 },
  { name: 'dodge', r: fight, start: fight.at('dodged') - 2.2, dur: 5, poster: 2.2 },
  { name: 'break', r: fight, start: stag - 1.2, dur: 8.5, poster: 3.2 },
  { name: 'phase2', r: fight, start: p2 - 0.6, dur: 7.5, poster: 3 },
  { name: 'fissure', r: fight, start: fight.at('fissure', { after: p2 }) - 2.6, dur: 6, poster: 2.9 },
  { name: 'phase3', r: fight, start: p3 - 0.6, dur: 8, poster: 4 },
  { name: 'leap', r: fight, start: fight.at('leapTakeoff', { after: p3 }) - 1.8, dur: 6, poster: 2.6 },
  { name: 'meteors', r: fight, start: fight.at('meteorWarn', { after: p3 }) - 0.5, dur: 7.5, poster: 4.2 },
  { name: 'victory', r: fight, start: fight.at('victoryCine') - 1.6, dur: 10, poster: 5 },
  { name: 'fallen', r: lose, start: lose.at('playerHit', { last: true }) - 1.6, dur: 8.5, poster: 7.5 },
];
for (const c of CLIPS) {
  c.start = Math.max(0, Math.min(c.start, c.r.dur - c.dur));
  const file = path.join(out, `${c.name}.mp4`);
  ff(['-ss', c.start.toFixed(3), '-t', String(c.dur), '-i', c.r.file, '-vf', 'scale=1280:-2:flags=lanczos', ...x264(24), file]);
  ff(['-ss', (c.start + c.poster).toFixed(3), '-i', c.r.file, '-frames:v', '1', '-vf', 'scale=1280:-2:flags=lanczos', '-q:v', '4', path.join(out, `${c.name}.jpg`)]);
  console.log(`clip ${c.name}: ${c.start.toFixed(1)} s +${c.dur}, ${mb(file)} MB`);
}

// ---------------------------------------------------------------- the whole fight, uncut
// Cloudflare Pages takes files up to 25 MiB: 960x540 with a bitrate cap keeps the full fight under it.
{
  const file = path.join(out, 'fight.mp4');
  const kbps = Math.min(1400, Math.floor((23.5 * 8 * 1024) / fight.dur));
  ff(['-i', fight.file, '-vf', 'scale=960:-2:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', file]);
  ff(['-ss', (p3 + 3).toFixed(3), '-i', fight.file, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '4', path.join(out, 'fight.jpg')]);
  console.log(`whole fight: ${fight.dur.toFixed(0)} s at ${kbps} kbit/s cap, ${mb(file)} MB`);
}

// ---------------------------------------------------------------- chapters for the fight recorder
{
  const r1 = (t) => Math.round(t * 10) / 10;
  const m = fight.meta.marks;
  const start = fight.at('fight');
  const end = fight.at('victory_screen');
  const events = [];
  events.push({ t: r1(start), kind: 'start', label: 'The fight begins' });
  const staggers = m.filter((x) => x.label === 'staggerStart');
  staggers.forEach((x, i) => events.push({ t: r1(x.t), kind: 'break', label: i === 0 ? 'First break: it falls to its knees' : `Break ${i + 1}` }));
  events.push({ t: r1(p2), kind: 'phase', label: 'Phase II: the cracks wake' });
  events.push({ t: r1(p3), kind: 'phase', label: 'Phase III: the molten heart' });
  const leap = m.find((x) => x.label === 'leapTakeoff');
  if (leap) events.push({ t: r1(leap.t), kind: 'danger', label: 'The first leap' });
  const met = m.find((x) => x.label === 'meteorWarn');
  if (met) events.push({ t: r1(met.t), kind: 'danger', label: 'Meteor rain' });
  events.push({ t: r1(fight.at('victoryCine')), kind: 'end', label: 'The killing blow' });
  events.push({ t: r1(end), kind: 'end', label: 'Ruin silenced' });
  events.sort((a, b) => a.t - b.t);
  const count = (label) => m.filter((x) => x.label === label).length;
  const data = {
    duration: r1(fight.dur),
    phases: [
      { n: 1, from: r1(start), to: r1(p2) },
      { n: 2, from: r1(p2), to: r1(p3) },
      { n: 3, from: r1(p3), to: r1(end) },
    ],
    events,
    stats: {
      fightSeconds: Math.round(fight.meta.fightTime ?? end - start),
      coreHits: count('coreHit'),
      deflects: count('deflect'),
      dodges: count('dodged'),
      breaks: staggers.length,
      hitsTaken: count('playerHit'),
    },
  };
  fs.writeFileSync(path.join(out, 'chapters.json'), JSON.stringify(data, null, 1));
  console.log('chapters:', events.length, 'events', data.stats);
}

// ---------------------------------------------------------------- greybox to finished, on the same beats
{
  const stages = { grey: 'test-output/m1-critic-r16', blender: 'test-output/m2-critic-r1', final: 'test-output/final-critic' };
  const beats = { punish: '06_slam_stuck_punish.png', roar: '12_phase2_roar.png', meteor: '14_phase3_meteor.png' };
  for (const [b, file] of Object.entries(beats)) {
    for (const [s, dir] of Object.entries(stages)) {
      const src = path.join(root, dir, file);
      if (!fs.existsSync(src)) {
        console.log(`skip evolution ${b}/${s}: no ${dir}/${file}`);
        continue;
      }
      ff(['-i', src, '-vf', 'scale=1280:-2:flags=lanczos', '-q:v', '4', path.join(out, `evo-${b}-${s}.jpg`)]);
    }
  }
  console.log('evolution stills done');
}

// ---------------------------------------------------------------- one still per milestone
{
  const stills = {
    m1: 'test-output/m1-critic-r16/09_stomp_ring.png',
    m2: 'test-output/m2-critic-r16/11_stagger_back_core.png',
    m3: 'test-output/m3-critic-r10/12_core_hit_b.png',
    m4: 'test-output/m4-critic-r3/03_how_to_fight.png',
    m5: 'screenshots/05_meteor_rain.png',
  };
  for (const [k, src] of Object.entries(stills)) {
    const f = path.join(root, src);
    if (!fs.existsSync(f)) {
      console.log(`skip milestone still ${k}: no ${src}`);
      continue;
    }
    ff(['-i', f, '-vf', 'scale=640:-2:flags=lanczos', '-q:v', '4', path.join(out, `milestone-${k}.jpg`)]);
  }
}

// ---------------------------------------------------------------- share image
{
  const t = fight.at('phaseChange', { info: '3' }) + 4;
  ff(['-ss', t.toFixed(3), '-i', fight.file, '-frames:v', '1', '-vf', 'scale=1200:-2', '-q:v', '4', path.join(out, 'og.jpg')]);
}

// ---------------------------------------------------------------- README GIFs: small, short, one palette each
for (const n of ['strike', 'dodge', 'break', 'phase3', 'meteors', 'victory']) {
  const c = CLIPS.find((x) => x.name === n);
  const dur = Math.min(c.dur, 4.5);
  const start = c.start + Math.max(0, Math.min(c.poster - 2, c.dur - dur));
  const file = path.join(gifs, `${n}.gif`);
  ff(['-ss', start.toFixed(3), '-t', String(dur), '-i', c.r.file, '-vf',
    'fps=12,scale=560:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', file]);
  console.log(`gif ${n}: ${mb(file)} MB`);
}
console.log('done');
