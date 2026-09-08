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

// CUSTOM-JOURNAL: this used to be a `build.lib` config with `formats: ['es']` +
// rollupOptions.output.format: 'system' - but Vite's lib mode only accepts
// 'es'/'cjs'/'umd'/'iife' for `formats` (not 'system'), and hard-codes ESM
// output handling once 'es' is picked, silently ignoring the rollupOptions
// override. The built release/index.js was plain `export {...}` ESM, not
// SystemJS's `System.register(...)` wrapper - it would have failed to load via
// Blinko's `System.import('/plugins/<name>/index.js')`. Using a plain
// (non-lib) rollupOptions.input/output instead actually respects format: 'system'.
export default defineConfig({
  build: {
    outDir: 'release',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/index.tsx'),
      // CUSTOM-JOURNAL: without build.lib, Rollup's default tree-shaking treats
      // this entry's `export default class ...` as unused (nothing inside the
      // bundle imports it - it's only ever consumed externally, by Blinko's
      // System.import() loader) and drops it entirely ("Generated an empty
      // chunk"). treeshake:false alone wasn't enough - it kept the class body but
      // Rollup's getExportMode still didn't register a default export binding in
      // the SystemJS wrapper (System.import(...).default would be undefined).
      // preserveEntrySignatures:'strict' is the actual fix: it tells Rollup this
      // entry's exports form a public API to preserve exactly, which both keeps
      // the class AND correctly emits the SystemJS export() call for it.
      preserveEntrySignatures: 'strict',
      output: {
        format: 'system',
        entryFileNames: 'index.js',
      },
    },
  },
});
