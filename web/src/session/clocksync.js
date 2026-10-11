// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * clocksync.js — the Move's playhead, in this page's time. Pure.
 *
 * The Move runs the session; the page sees a picture of it some unknown time
 * later. That time is anything from ~20 ms to ~400 ms -- ui.js's publish, the
 * DSP, the shim's probe, the manager's throttled read, WiFi, the iframe -- and
 * it is different for every picture. A page that starts its playhead from a
 * picture's ARRIVAL draws every update pulled back by that picture's delay, a
 * different amount each time: the scroll jitters, and now and then jumps.
 *
 * So the session stamps each picture with its own time (clock.t, the Move's
 * performance.now() at the tick the picture is of), and the page works out
 * what time it is ON THE MOVE:
 *
 *   createClockSync()     the offset between the two clocks
 *     observe(t, local)     one picture: taken at Move time t, here at local
 *     deviceNow(local)      Move time now, or null before the first picture
 *
 *   A picture can arrive late but never early, so local - t is the offset
 *   plus a delay that is never negative: its MINIMUM over recent pictures is
 *   the offset plus the smallest delay seen, which a few pictures bring to
 *   within a few ms. Recent: the last 64, and the last 30 s, so the window
 *   follows the slow drift between two crystals (~50 ppm) and forgets a
 *   clock that was reset (a Move rebooted, a page left open).
 *
 *   createPlayhead()      where to DRAW the playhead
 *     anchor(clock, local)  a new picture's clock arrived at `local`
 *     at(local)             the beat to draw at `local`
 *
 *   The beat is the picture's, carried forward from ITS time at its tempo,
 *   and never past `clock.waitAt` -- where the Move freezes, waiting for a
 *   note. It does not move while paused, stopped or frozen.
 *
 *   What the drawing does with a correction: when a new picture puts the beat
 *   a little away from where it was being drawn, the difference is eased out
 *   over ~100 ms rather than stepped, and a moving playhead never steps back
 *   -- it holds until the beat catches up. A difference of a beat or more is
 *   a real jump (a restart, a seek, a new piece) and is drawn at once.
 *
 * A picture without `t` (an older module) falls back to its arrival time:
 * the old behaviour, delays and all.
 *
 * The plugin repository's web kit has the same two (web/kit/src/lib/clock.js,
 * neon-ingvy-audio-plugins) for the Trance Gate's and Side-Chain's editors.
 */

export const SYNC_SAMPLES = 64;
export const SYNC_SPAN_MS = 30000;
/* How long an eased correction takes to fade to a third. */
export const EASE_MS = 100;
/* A difference this large, in beats, is a jump to draw at once. */
export const SNAP_BEATS = 1;

export function createClockSync({ samples = SYNC_SAMPLES, spanMs = SYNC_SPAN_MS } = {}) {
  const seen = [];          /* [{ local, offset }] oldest first */
  let best = null;

  function recompute() {
    best = null;
    for (const s of seen) if (best === null || s.offset < best) best = s.offset;
  }

  return {
    observe(t, local) {
      if (!Number.isFinite(t) || !Number.isFinite(local)) return;
      seen.push({ local, offset: local - t });
      while (seen.length > samples || (seen.length > 1 && local - seen[0].local > spanMs)) seen.shift();
      recompute();
    },
    deviceNow: (local) => (best === null ? null : local - best),
    get offset() { return best; },
  };
}

export function createPlayhead({ sync = createClockSync(), easeMs = EASE_MS, snapBeats = SNAP_BEATS } = {}) {
  let c = null;             /* the latest picture's clock */
  let arrivedAt = 0;        /* when it arrived, for a picture without t */
  let ease = 0;             /* the correction still being eased out, in beats */
  let easeFrom = 0;
  let shown = null;         /* the beat drawn last */

  const moving = (k) => !!k && k.running && !k.paused && !k.blocked && k.perBeatMs > 0;

  /* The beat the Move freezes on, or Infinity. Never behind the picture's own
   * beat: a picture already past it (a stale waitAt) is not pulled back. */
  const stopAt = () => (c.waitAt === null || c.waitAt === undefined ? Infinity : Math.max(c.beats, c.waitAt));

  /* Where the beat truly is at `local`, by the latest picture. */
  function target(local) {
    if (!c) return 0;
    let b = c.beats;
    if (moving(c)) {
      const dev = c.t === null || c.t === undefined ? null : sync.deviceNow(local);
      const elapsed = dev === null ? local - arrivedAt : dev - c.t;
      b += Math.max(0, elapsed) / c.perBeatMs;
    }
    return Math.min(b, stopAt());
  }

  function at(local) {
    if (!c) return null;
    let b = target(local) + ease * Math.exp(-(local - easeFrom) / easeMs);
    /* Moving, the playhead never steps back: it holds until the beat passes. */
    if (moving(c) && shown !== null && b < shown) b = shown;
    b = Math.min(b, stopAt());
    shown = b;
    return b;
  }

  return {
    anchor(clock, local) {
      if (!clock) return;
      if (Number.isFinite(clock.t)) sync.observe(clock.t, local);
      const was = c && shown !== null ? at(local) : null;
      c = clock;
      arrivedAt = local;
      const now = target(local);
      const diff = was === null ? Infinity : was - now;
      if (!moving(c) || Math.abs(diff) >= snapBeats) {
        ease = 0;
        shown = null;
      } else {
        ease = diff;
        easeFrom = local;
      }
    },
    at,
    sync,
  };
}
