// Copied from neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/src/lib/icons.js), MIT, Torben Gräber.
// Changed: the glob reads web/design/icons, this repository's vendored copy of the set.
/*
 * The fifteen glyphs, taken from the design system's own files at build time.
 * Copyright (c) 2026 Torben Gräber. MIT.
 *
 * NOT COPIED BY HAND. Vite reads web/design/icons/*.svg -- the vendored,
 * byte-faithful copy of the published system's Icons (web/design/SOURCE.md) --
 * and inlines them, so a re-vendored icon arrives on the next build.
 */
import { iconBody, iconName } from './icon-svg.js';

const files = import.meta.glob('../../../design/icons/*.svg',
  { query: '?raw', import: 'default', eager: true });

export const ICONS = Object.fromEntries(
  Object.entries(files).map(([path, svg]) => [iconName(path), iconBody(svg)])
    .filter(([, body]) => body));
