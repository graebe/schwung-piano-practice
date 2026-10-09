// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * The browser UI's build.
 *
 *   npx vite --config web/vite.config.js           dev server, port 47331
 *   npx vite build --config web/vite.config.js     -> dist/web
 *   npx vite preview --config web/vite.config.js   the build, port 47332
 *
 * Relative everything (base './'): the pages are served from wherever
 * Schwung's web manager puts the module, inside a sandboxed iframe, over plain
 * HTTP and offline -- so no absolute URL and nothing from a CDN; fonts, icons
 * and the grain are bundled. The ports are this module's own, strict, so two
 * agents' servers cannot quietly swap places.
 *
 * Two pages: index.html, the app (a placeholder until the app lands), and
 * gallery.html, every component in its states, for review and screenshots.
 * `fs.allow ['..']` lets the pages import the module's pure engine
 * (../src/*.mjs) and its exercises, which live outside web/.
 */
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import licenses from '../scripts/vite-licenses.mjs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('.'),
  base: './',
  /* licenses(): the build fails on a bundled package THIRD_PARTY_LICENSES.md
   * does not list, and ships every bundled package's notice beside the page. */
  plugins: [solid(), licenses()],
  build: {
    outDir: here('../dist/web'),
    emptyOutDir: true,
    /* Source maps only for the end-to-end suite's coverage (PP_SOURCEMAP=1):
     * the page that ships carries none. */
    sourcemap: process.env.PP_SOURCEMAP === '1',
    assetsDir: 'assets',
    /* Never a script as a data: URL — audioWorklet.addModule needs a real one.
     * Fonts and images keep Vite's default. */
    assetsInlineLimit: (file) => (file.endsWith('.js') ? false : undefined),
    rollupOptions: {
      input: {
        index: here('index.html'),
        gallery: here('gallery.html'),
      },
      /* What the two pages share is the kit and the music components; name it
       * that rather than after whichever module rollup met first. */
      output: {
        chunkFileNames: 'assets/shared-[hash].js',
        assetFileNames: (asset) => {
          const name = (asset.names && asset.names[0]) || asset.name || '';
          const page = /^(index|gallery)\./.test(name);
          return name.endsWith('.css') && !page ? 'assets/shared-[hash][extname]' : 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  server: { port: 47331, strictPort: true, fs: { allow: [here('..')] } },
  preview: { port: 47332, strictPort: true },
});
