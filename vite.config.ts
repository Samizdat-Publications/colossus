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

// Ports are pinned so the self-test never talks to a sibling game's dev server.
export default defineConfig({
  plugins: [balanceDefaults()],
  server: { host: '127.0.0.1', port: 5419, strictPort: false },
  preview: { host: '127.0.0.1', port: 4419, strictPort: false },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
