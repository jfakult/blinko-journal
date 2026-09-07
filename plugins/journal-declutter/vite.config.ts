// vite.config.ts
//
// CAVEAT (read before relying on this as-is): Blinko loads installed plugins
// via SystemJS (`System.import('/plugins/<name>/index.js')` — see
// app/src/store/plugin/pluginManagerStore.ts in the main repo), so the build
// output needs to be a SystemJS-format module. Rollup (which Vite uses under
// the hood) has a built-in `system` output format, which is what this config
// targets below. That said, the official docs (https://docs.blinko.space/en/plugins/get-started.md
// and https://docs.blinko.space/en/plugins/publish-plugin.md) point to a
// `blinko-cli` tool and a `bun release:publish` script for scaffolding/building
// the *authoritative* way, and don't publish their vite.config.ts — this file
// is a best-effort reconstruction, not a copy of the official template.
//
// Before shipping: run `bun install && bun run build`, confirm `release/index.js`
// loads without errors in the browser console after installing the plugin
// (look for the "[journal-declutter] loaded" log from src/index.tsx), and if
// it doesn't, scaffold a fresh plugin with the current blinko-cli and copy
// src/index.tsx + src/style.css + plugin.json into it instead of debugging
// this config blind.

import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'release',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/index.tsx'),
      name: 'JournalDeclutterPlugin',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      output: {
        format: 'system',
      },
    },
  },
});
