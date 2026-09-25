#!/usr/bin/env node
/**
 * Regenerates every asset by running the Blender family scripts in background Blender, in order:
 *   textures -> golem -> warrior -> arena -> pillars -> rubble
 *   npm run assets [-- golem arena]      (only the named families)
 * Needs Blender 5.x: BLENDER_PATH, or the default Windows install path. Logs go to
 * test-output/blender-logs/<family>.log; outputs to public/assets/.
 * (During development the same scripts are launched from the Blender MCP with co_launch.py.)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const families = ['textures', 'golem', 'warrior', 'arena', 'pillars', 'rubble'];
const wanted = process.argv.slice(2).filter((a) => families.includes(a));
const list = wanted.length ? families.filter((f) => wanted.includes(f)) : families;
const candidates = [
  process.env.BLENDER_PATH,
  'C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe',
  'C:\\Program Files\\Blender Foundation\\Blender 5.0\\blender.exe',
  '/Applications/Blender.app/Contents/MacOS/Blender',
  '/usr/bin/blender',
].filter(Boolean);
const blender = candidates.find((p) => fs.existsSync(p));
if (!blender) {
  console.error('Blender not found: set BLENDER_PATH to your Blender 5.x executable.');
  process.exit(1);
}
const logs = path.join(root, 'test-output', 'blender-logs');
fs.mkdirSync(logs, { recursive: true });

function run(family) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const log = fs.createWriteStream(path.join(logs, `${family}.log`));
    const p = spawn(blender, ['--background', '--factory-startup', '--python-exit-code', '3', '--python', path.join(root, 'blender_scripts', `${family}.py`)], { cwd: root });
    p.stdout.pipe(log);
    p.stderr.pipe(log);
    p.stdout.on('data', (d) => {
      for (const line of d.toString().split('\n')) if (line.startsWith('[co ')) console.log(`  ${family}: ${line}`);
    });
    p.on('close', (code) => {
      console.log(`${family}: ${code === 0 ? 'ok' : `FAILED (exit ${code})`} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      resolve(code === 0);
    });
  });
}

let ok = true;
for (const f of list) ok = (await run(f)) && ok;
process.exit(ok ? 0 : 1);
