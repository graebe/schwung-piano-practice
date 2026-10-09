// Copied from neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/src/lib/keys.js), MIT, Torben Gräber.
/*
 * What a key does to a control, as plain functions.
 * Copyright (c) 2026 Torben Gräber. MIT.
 *
 * "A focus ring on a control you cannot operate is decoration." Every control
 * that takes a pointer takes the keyboard too; the mapping lives here so it can
 * be tested without a DOM and so every control answers the same keys the same
 * way.
 */
import { nextDetent } from './detents.js';

/**
 * A grid of `count` cells, `cols` to a row: where an arrow, Home or End moves
 * focus from `index`, or null for a key that is not a move. Does not wrap: the
 * edges stop, as a grid in a window does.
 */
export function gridMove(key, index, count, cols) {
  const last = count - 1;
  switch (key) {
    case 'ArrowRight': return Math.min(last, index + 1);
    case 'ArrowLeft': return Math.max(0, index - 1);
    case 'ArrowDown': return index + cols <= last ? index + cols : index;
    case 'ArrowUp': return index - cols >= 0 ? index - cols : index;
    case 'Home': return index - (index % cols);
    case 'End': return Math.min(last, index - (index % cols) + cols - 1);
    default: return null;
  }
}

/**
 * A step pad's keys: Space or Enter toggles (shift: tie), and with Alt held the
 * vertical arrows set its amount -- plain arrows move between pads.
 * -> { toggle: true, tie } | { depth: delta } | { move: index } | null
 */
export function padKey(e, index, count, cols) {
  if (e.key === ' ' || e.key === 'Enter') return { toggle: true, tie: !!e.shiftKey };
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    const step = e.shiftKey ? 0.01 : 0.1;
    return { depth: e.key === 'ArrowUp' ? step : -step };
  }
  const to = gridMove(e.key, index, count, cols);
  return to === null ? null : { move: to };
}

/**
 * A slider's keys, as a fraction of its range: arrows 1 %, shift 0.2 % (the
 * knob's fine ratio of 5), Page 10 %, Home/End the ends. `axis` limits the
 * arrows to 'x' (Left/Right) or 'y' (Up/Down); 'both' takes all four.
 * -> { delta } | { to: 0 | 1 } | null
 */
export function sliderKey(e, axis = 'both') {
  const fine = e.shiftKey ? 0.002 : 0.01;
  const x = axis !== 'y';
  const y = axis !== 'x';
  switch (e.key) {
    case 'ArrowRight': return x ? { delta: fine } : null;
    case 'ArrowLeft': return x ? { delta: -fine } : null;
    case 'ArrowUp': return y ? { delta: fine } : null;
    case 'ArrowDown': return y ? { delta: -fine } : null;
    case 'PageUp': return { delta: fine * 10 };
    case 'PageDown': return { delta: -fine * 10 };
    case 'Home': return { to: 0 };
    case 'End': return { to: 1 };
    default: return null;
  }
}

/** Tabs: Left/Right (and Up/Down, for a vertical strip) move, wrapping. */
export function tabMove(key, index, count) {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/**
 * A count (a length in steps, say): arrows by one, Page by `page`, Home/End to
 * the ends. With `detents`, Page goes to the next one that way instead, and by
 * `page` only where there is none. -> the new count, or null for a key that is
 * not one of these.
 */
export function countKey(e, value, min, max, page = 4, detents) {
  const clamp = (v) => Math.min(max, Math.max(min, v));
  const pageTo = (dir) => clamp(nextDetent(value, detents, dir) ?? value + dir * page);
  switch (e.key) {
    case 'ArrowUp': case 'ArrowRight': return clamp(value + 1);
    case 'ArrowDown': case 'ArrowLeft': return clamp(value - 1);
    case 'PageUp': return pageTo(1);
    case 'PageDown': return pageTo(-1);
    case 'Home': return min;
    case 'End': return max;
    default: return null;
  }
}
