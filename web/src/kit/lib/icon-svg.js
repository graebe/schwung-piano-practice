// Copied from neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/src/lib/icon-svg.js), MIT, Torben Gräber.
/*
 * The design system's icon files, read. Copyright (c) 2026 Torben Gräber. MIT.
 *
 * Plain JavaScript so node can test it against the files themselves.
 */

/* "play and record are filled; every other glyph is stroke only" -- the Icons
 * README. The files are single-ink and all say fill="none"; the component's
 * preview fills these two with currentColor, and so does the Icon here. */
export const FILLED = new Set(['play', 'record']);

/** The glyph's drawing -- everything inside the <svg> -- or null. */
export function iconBody(svg) {
  if (typeof svg !== 'string') return null;
  const m = /<svg\b[^>]*viewBox="0 0 16 16"[^>]*>([\s\S]*)<\/svg>\s*$/.exec(svg.trim());
  if (!m) return null;
  const body = m[1].trim();
  /* Only the shapes the set is drawn with; nothing that could carry a style,
   * a script or a colour of its own. */
  if (!/^(?:<(?:path|circle)\b[^<>]*?\/?>(?:<\/(?:path|circle)>)?\s*)+$/.test(body)) return null;
  if (/\b(?:style|fill|stroke|on\w+)\s*=/.test(body)) return null;
  return body;
}

/** "…/Icons/copy.svg" -> "copy". */
export const iconName = (path) => path.replace(/^.*\//, '').replace(/\.svg$/, '');
