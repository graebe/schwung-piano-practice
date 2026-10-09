// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * The licence notices of whatever the web build bundles, written beside it.
 * From neon-ingvy-audio-plugins (scripts/vite-licenses.mjs @4e15cc8, MIT there,
 * same author), with its notice list read from this repository's
 * THIRD_PARTY_LICENSES.md headings.
 *
 * WHY THIS EXISTS. An editor's ui.js is minified, and minifying removes every
 * comment -- including the notices MIT asks to accompany each copy. Solid's
 * dist files carry no `/*! @license *\/` comment for `legalComments` to keep
 * in the first place, so preserving comments would have preserved nothing.
 * The notices therefore come from the packages themselves: every npm package
 * with code in the bundle is found through rollup's module graph, and its
 * LICENSE file is copied into assets/ui.js.LICENSE.txt, which ships in the
 * plugin bundle beside ui.js. ui.js gets a one-line comment pointing there.
 *
 * AND THE BUILD FAILS on a bundled package that THIRD_PARTY_LICENSES.md does
 * not list, or that has no licence file to copy. A dependency added to an
 * editor has to be written down before it can ship.
 *
 * Used by every plugins/<name>/ui/vite.config.js:
 *
 *   import licenses from '../../../scripts/vite-licenses.mjs';
 *   plugins: [solid(), licenses()],
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOTICE_FILE = 'assets/THIRD_PARTY_LICENSES.txt';
const NOTICES = fileURLToPath(new URL('../THIRD_PARTY_LICENSES.md', import.meta.url));

/* Every package THIRD_PARTY_LICENSES.md has a section for: "## name version — licence". */
export function listedNames(markdown = readFileSync(NOTICES, 'utf8')) {
  const names = new Set();
  for (const m of markdown.matchAll(/^## (\S+)/gm)) names.add(m[1]);
  return names;
}

/* The directory of the npm package a module id belongs to, or null for this
 * repository's own code (the editors and the ui-kit, which the workspace
 * resolves to their real paths rather than through node_modules). */
function packageDirOf(id) {
  const clean = id.replace(/^\0/, '').split('?')[0];
  /* Vite's own injected runtime is a virtual module with no path at all. */
  if (clean.startsWith('vite/')) {
    return dirname(createRequire(import.meta.url).resolve('vite/package.json'));
  }
  const at = clean.lastIndexOf(`${sep}node_modules${sep}`);
  if (at < 0) return null;
  const rest = clean.slice(at + `${sep}node_modules${sep}`.length).split(sep);
  const depth = rest[0].startsWith('@') ? 2 : 1;
  return clean.slice(0, at) + `${sep}node_modules${sep}` + rest.slice(0, depth).join(sep);
}

/* A package's own licence. Vite's LICENSE.md goes on to list every package
 * bundled into Vite the TOOL; none of that reaches ui.js (only Vite's own
 * preload polyfill does), so the text stops where that list begins. */
function licenceText(dir) {
  const f = readdirSync(dir).find((n) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(n));
  if (!f) return null;
  return readFileSync(join(dir, f), 'utf8').split(/^# Licenses of bundled dependencies/m)[0].trim();
}

export default function licenses() {
  return {
    name: 'ni-third-party-notices',
    apply: 'build',
    generateBundle(_options, bundle) {
      const listed = listedNames();
      const packages = new Map();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const [id, info] of Object.entries(chunk.modules)) {
          if (!info.renderedLength) continue;         /* tree-shaken away */
          const dir = packageDirOf(id);
          if (!dir || packages.has(dir)) continue;
          if (!existsSync(join(dir, 'package.json')))
            this.error(`cannot find the package that ${id} belongs to`);
          packages.set(dir, JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')));
        }
      }

      const sections = [];
      for (const [dir, pkg] of [...packages].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
        if (!listed.has(pkg.name))
          this.error(`the web build bundles ${pkg.name}@${pkg.version} (${pkg.license}), which ` +
                     'THIRD_PARTY_LICENSES.md does not list -- add a section for it before it ships');
        const text = licenceText(dir);
        if (!text) this.error(`${pkg.name}@${pkg.version} has no LICENSE file to ship`);
        sections.push(`${pkg.name}@${pkg.version} -- ${pkg.license}\n\n${text}`);
      }

      this.emitFile({
        type: 'asset',
        fileName: NOTICE_FILE,
        source:
          'Third-party software bundled in this page, and the notices its licences require.\n' +
          'The rest is Copyright (C) 2026 Torben Gräber, GPL-3.0-or-later -- see LICENSE and\n' +
          'THIRD_PARTY_LICENSES.md, which ship with the module.\n\n' +
          sections.map((s) => `${'='.repeat(78)}\n${s}\n`).join('\n'),
      });

      /* After minification (generateBundle runs last), so it survives. */
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && chunk.isEntry)
          chunk.code = `/*! Copyright (C) 2026 Torben Gräber, GPL-3.0-or-later. Bundled ` +
                       `third-party licences: THIRD_PARTY_LICENSES.txt */\n${chunk.code}`;
      }
    },
  };
}
