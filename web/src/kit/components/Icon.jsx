// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
// From the neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/src/components/Icon.jsx).
/*
 * A machine glyph from the design system's set.
 *
 * 16px, 1.5px stroke, square caps, drawn in currentColor so it takes the colour
 * of its control: ink at rest, on-uv on a lit button, ink-dim when disabled.
 * Fifteen glyphs -- play, pause, stop, record, loop, copy, paste, export,
 * export-all, import, shuffle, reset, link, chevron, power -- and never one
 * outside the set.
 *
 * Decorative to assistive technology: an icon replaces a WORD on a control,
 * and the control carries that word as its aria-label.
 */
import { ICONS } from '../lib/icons.js';
import { FILLED } from '../lib/icon-svg.js';

export function Icon(props) {
  return (
    <svg class="icon" viewBox="0 0 16 16" width="16" height="16"
         fill={FILLED.has(props.name) ? 'currentColor' : 'none'}
         stroke="currentColor" stroke-width="1.5"
         stroke-linecap="square" stroke-linejoin="miter"
         aria-hidden="true" innerHTML={ICONS[props.name] ?? ''} />
  );
}
