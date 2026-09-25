import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * public/balance.json is the single tuning file. It is fetched at runtime (so a built game can be
 * re-tuned by editing dist/balance.json), and this plugin also inlines it as the fallback defaults.
 */
function balanceDefaults(): Plugin {
  const file = path.resolve(import.meta.dirname, 'public/balance.json');
  const id = 'virtual:balance-defaults';
  const resolved = '\0' + id;
  return {
    name: 'balance-defaults',
    resolveId(source) {
      return source === id ? resolved : null;
    },
    load(loadId) {
      if (loadId !== resolved) return null;
      this.addWatchFile(file);
      return `export default ${fs.readFileSync(file, 'utf8')};`;
    },
  };
}

/**
 * The GLB assets are Draco-compressed. The decoder ships inside the three package; this plugin serves it
 * at /draco/ in dev and copies it into the build, so nothing is fetched from outside.
 */
function dracoDecoder(): Plugin {
  const dir = path.resolve(import.meta.dirname, 'node_modules/three/examples/jsm/libs/draco/gltf');
  const files = ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js'];
  return {
    name: 'draco-decoder',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(/\/draco\/([\w.]+)$/);
        if (!m || !files.includes(m[1])) return next();
        res.setHeader('Content-Type', m[1].endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.end(fs.readFileSync(path.join(dir, m[1])));
      });
    },
    generateBundle() {
      for (const f of files) this.emitFile({ type: 'asset', fileName: `draco/${f}`, source: fs.readFileSync(path.join(dir, f)) });
    },
  };
}

// Ports are pinned so the self-test never talks to a sibling game's dev server.
export default defineConfig({
  plugins: [balanceDefaults(), dracoDecoder()],
  server: { host: '127.0.0.1', port: 5419, strictPort: false },
  preview: { host: '127.0.0.1', port: 4419, strictPort: false },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
