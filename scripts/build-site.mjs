#!/usr/bin/env node
/**
 * Builds the public site into site-dist/:
 *
 *   site-dist/          the landing page (site/), its media in site-dist/media/
 *   site-dist/play/     the game, built with base /play/
 *
 *   node scripts/build-site.mjs            build
 *   node scripts/build-site.mjs --deploy   build, then deploy to Cloudflare Pages (project colossus)
 */
import { build } from 'vite';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'site-dist');
fs.rmSync(out, { recursive: true, force: true });

await build({ root, base: '/play/', logLevel: 'warn', build: { outDir: path.join(out, 'play'), emptyOutDir: true } });
fs.cpSync(path.join(root, 'site'), out, { recursive: true });

// The landing page uses the game's own fonts, straight from the npm packages (no runtime font service).
const fonts = path.join(out, 'fonts');
fs.mkdirSync(fonts, { recursive: true });
const cinzel = path.join(root, 'node_modules/@fontsource/cinzel/files');
const garamond = path.join(root, 'node_modules/@fontsource/eb-garamond/files');
for (const w of [600, 700]) fs.copyFileSync(path.join(cinzel, `cinzel-latin-${w}-normal.woff2`), path.join(fonts, `cinzel-${w}.woff2`));
for (const w of [400, 600]) fs.copyFileSync(path.join(garamond, `eb-garamond-latin-${w}-normal.woff2`), path.join(fonts, `garamond-${w}.woff2`));
fs.copyFileSync(path.join(garamond, 'eb-garamond-latin-400-italic.woff2'), path.join(fonts, 'garamond-400-italic.woff2'));

// Long cache for media and fonts, no cache for the page itself (Cloudflare Pages _headers file).
fs.writeFileSync(
  path.join(out, '_headers'),
  ['/media/*', '  Cache-Control: public, max-age=604800', '/fonts/*', '  Cache-Control: public, max-age=31536000, immutable', '/play/assets/*', '  Cache-Control: public, max-age=604800', ''].join('\n'),
);

const files = fs.readdirSync(out, { recursive: true, withFileTypes: true }).filter((d) => d.isFile());
const bytes = files.reduce((s, d) => s + fs.statSync(path.join(d.parentPath, d.name)).size, 0);
console.log(`site-dist: ${files.length} files, ${(bytes / 1e6).toFixed(1)} MB`);
// Cloudflare Pages refuses files over 25 MiB and projects over 20,000 files.
for (const d of files) {
  const f = path.join(d.parentPath, d.name);
  if (fs.statSync(f).size > 25 * 1024 * 1024) throw new Error(`${f} is over the 25 MiB Cloudflare Pages limit`);
}

if (process.argv.includes('--deploy')) {
  execSync('npx wrangler pages deploy site-dist --project-name colossus --branch main --commit-dirty=true', { cwd: root, stdio: 'inherit' });
}
