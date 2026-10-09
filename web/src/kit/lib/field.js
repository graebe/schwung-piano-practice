// Copied from neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/src/lib/field.js), MIT, Torben Gräber.
/*
 * The animated ground: a damped wave field on the dot paper.
 * Copyright (c) 2026 Torben Gräber. MIT.
 *
 * A PORT, NOT A DESIGN. Every number and every step here comes from the
 * Ultraviolet design system's own reference implementation,
 * design/scheme/project/components/ground.js, and the model is spelled out in
 * design/scheme/project/README.md under Motion. Nothing in this file is a
 * judgement call about how the background should look -- if it reads wrong, the
 * design system is where that gets decided.
 *
 * WHAT IT DOES. A trigger makes every panel edge and the window border emit one
 * slow ring. Rings travel through the background only -- panels and wells are
 * solid to them -- reflect off those edges and off the window border, cross each
 * other and interfere, and the whole field rings out over about twenty seconds.
 * On a peak the dots grow and brighten and the grain thickens; in a valley they
 * shrink and dim and it thins. THE GRAIN ITSELF NEVER MOVES, only its local
 * density: moving grain reads as television static.
 *
 * With no trigger the field is exactly zero, the canvas shows the static design --
 * the same dots, the same colours, grain of the same density -- and the render
 * loop STOPS. That last part is not an optimisation, it is the design's rule:
 * "Controls never animate", and a background that idles is a background that is
 * animating. (It is not PIXEL-identical to the CSS fallback underneath: the
 * grain is uniform noise either way, but this tile is drawn fresh with
 * Math.random, as the design's reference does, and the CSS one is the design's
 * fixed PNG. Only the canvas is ever on screen while it works, so no seam shows.)
 *
 * ITS CLOCK IS THE PLUGIN, NOT requestAnimationFrame, AND IT DOES NOT PAUSE
 * WHILE THE DOCUMENT IS HIDDEN. In a real host WebKit treats a plugin editor
 * as a hidden page: about one animation frame in three seconds, and the
 * page's own timers throttled to a few hertz -- while the plugin's messages
 * arrive at once. A field clocked by frames, or one that paused while hidden,
 * as this one once did, never moved in Live. So the field reports when it
 * starts and stops moving (`onRunning`), the plugin sends a frame tick on
 * every idle tick in between, about fifty a second (ni/Editor.h, kGroundTick),
 * and each `tick()` steps the simulation by the time that really passed and
 * draws. A page timer is only the fallback for ticks that stop coming -- a
 * harness, a plugin too old to send them. Work stops when the field rings
 * out, and the plugin stops ringing it when its window closes.
 * prefers-reduced-motion is followed live rather than read once.
 *
 * WHAT IS NOT HERE, AND WHY. The reference ships a second half, a BeatClock
 * that a page ticks with the host's position to find the beats. A plugin's
 * page cannot see the host's transport, so the same rule runs in Rust on the
 * audio thread (engines/ground): a ring on every beat while the song plays,
 * the downbeat strongest (docs/tech/ground.md), arriving as a message;
 * `trigger` is where it lands. This is the ONLY part of the reference that
 * is not here.
 *
 * NO COLOUR IS SPELLED HERE. The reference carries three RGB triples in its
 * defaults; a canvas cannot use a CSS variable, so this reads them back out of
 * tokens.css through `readRgb` -- the same seam, and for the same reason, as
 * lib/ramp.js. See the note at the top of that file.
 */

import { readRgb, cssHex } from './ramp.js';
import { viewScale, backingRatio } from './ground-geometry.js';

/*
 * THE DESIGN'S PARAMETER TABLE. Retuning any of these is a design-system change
 * and not a code change: `gain` and `tau` in particular are what keep the field
 * reading as a background rather than as an effect, and the README says so.
 */
const DEFAULTS = {
  pitch: 12,       // dot pitch, px (space-3)
  cell: 6,         // simulation grid, px (half a pitch)
  speed: 100,      // c, px/s
  freq: 1.5,       // f0 of the source wavelet, Hz -> wavelength c/f0 ~ 67 px
  tau: 3.5,        // amplitude e-folding time, s (gamma = 2/tau)
  gain: 65,        // source strength A: one kick peaks near u ~ 0.9
  border: true,    // the window border emits as well as reflects
  dt: 1 / 60,      // fixed simulation step, s
  maxSteps: 6,     // per frame, after a stall
  rest: 0.004,     // below this everywhere the field is reset and the loop stops
  dotR: 1.0,       // dot radius at rest, px
  dotDR: 0.4,      // +- radius at |v| = 1
  dotDA: 0.3,      // +- relative dot opacity at |v| = 1
  grainBase: 0.5,  // grain layer opacity at rest (tile mean 10% -> 5% effective)
  grainK: 0.8,     // grain gain per unit v
  grainMin: 0.2,   // -> 2% effective in the deepest valley
  grainMax: 0.9,   // -> 9% effective on the highest peak
  fps: 30,
};

/* The three tokens the canvas needs. The reference implementation carries these
 * as RGB literals in its defaults; here they are read back out of tokens.css,
 * for the reason lib/ramp.js gives at length -- a colour written into JavaScript
 * is a colour outside the stylesheet, and the token guard exists to stop that.
 *
 * THERE IS NO FALLBACK, deliberately, and ramp.js's `readStops` set the
 * precedent: a missing token is a bug in the stylesheet, not a case to paper
 * over. A plausible default would leave the ground looking nearly right with
 * colours nobody chose -- and, worse, would be a second copy of three values the
 * guard cannot see, which is exactly the drift it was written to prevent. */
const COLOUR_TOKENS = {
  bg: '--bg-000',
  dot: '--bg-dot',
  grain: '--uv-deep',
};

/* The sprite atlas quantises the wave into this many levels. MID is v = 0, the
 * ground at rest -- and a cell at MID is skipped entirely when drawing, which is
 * what makes a still field cost nothing. */
const LEVELS = 25;
const MID = (LEVELS - 1) / 2;

/* The grain tile: 96 px, a multiple of the 12 px pitch, so it tiles with the
 * dots. Alpha 0..20% gives a mean of 10%, which at grainBase 0.5 is the design's
 * 5% at rest. UNIFORM WHITE NOISE, not fractal -- the design is explicit, and a
 * fractal tile reads as cloth rather than as grain. */
const GRAIN_TILE = 96;
const GRAIN_MAX_ALPHA = 52;   // of 255, i.e. ~20%

/* The dot is drawn at this alpha over the background so that it reproduces
 * --bg-dot exactly; peaks then reach 100%. Any other value and a field at rest
 * would not match the static CSS ground. */
const DOT_ALPHA = 0.77;

/* With no frame tick from the plugin for this long, the field's own page
 * timer steps it instead -- slowly, in a host's hidden page, but never not at
 * all. */
const FALLBACK_AFTER_MS = 100;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const now = () => (globalThis.performance || Date).now();

/** Uniform white noise in `rgb`, as a tile. */
function makeGrain(rgb) {
  const n = GRAIN_TILE;
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n;
  const x = c.getContext('2d');
  const img = x.createImageData(n, n);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = rgb[0];
    d[i + 1] = rgb[1];
    d[i + 2] = rgb[2];
    d[i + 3] = Math.floor(Math.random() * GRAIN_MAX_ALPHA);
  }
  x.putImageData(img, 0, 0);
  return c;
}

/**
 * The dot fill that, at DOT_ALPHA over `bg`, comes out as `dot` exactly.
 *
 * Solving for the source colour rather than just drawing `dot` at full opacity
 * is what lets a peak brighten the dot ABOVE its resting colour without a second
 * token: the same fill at a higher alpha is the brighter dot.
 */
function dotBase(bg, dot) {
  const a = DOT_ALPHA;
  const s = [];
  for (let i = 0; i < 3; i++) s.push((dot[i] - bg[i] * (1 - a)) / a);
  return { rgb: cssHex(s), alpha: a };
}

/** A Ricker wavelet (the "Mexican hat"), peak at frequency `f`. */
function ricker(t, f) {
  let a = Math.PI * f * (t - 1 / f);
  a *= a;
  return (1 - 2 * a) * Math.exp(-a);
}

/**
 * Read the three colours out of the document's own custom properties.
 *
 * `el` is the element to resolve against, so a preview or a test can hand in a
 * subtree with different values.
 */
function readColours(el) {
  const out = {};
  for (const [key, token] of Object.entries(COLOUR_TOKENS)) {
    const rgb = readRgb(token, el);
    if (!rgb) throw new Error(`${token} is not a 6-digit hex colour in tokens.css`);
    out[key] = rgb;
  }
  return out;
}

export class Field {
  /**
   * @param canvas  the <canvas> to draw into; its CSS size is the field's size
   * @param opts    overrides for DEFAULTS, plus `colourFrom` (an element to
   *                resolve the tokens against, default documentElement)
   */
  constructor(canvas, opts = {}) {
    const o = (this.o = { ...DEFAULTS, ...opts });
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.kicks = [];
    this.rects = [];
    this.enabled = true;
    this.running = false;
    this.fallback = 0;
    this.lastTick = 0;
    /* When the last tick from outside arrived; see `tick`. */
    this.lastOutside = -Infinity;
    this.acc = 0;
    this.t = 0;
    /* The level each dot was last drawn at; see `draw`. */
    this.levels = null;
    this.fresh = true;

    /* prefers-reduced-motion disables the field OUTRIGHT, which the design
     * states as a rule rather than a preference: the Motion switch is a separate
     * control and cannot turn this back on. FOLLOWED, not read once -- a user
     * who turns it on mid-session means mid-session. */
    this._mq = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
    this.reduced = !!this._mq?.matches;
    this._onReduced = (e) => {
      this.reduced = !!e?.matches;
      if (this.reduced) this._flatten();
    };
    this._mq?.addEventListener?.('change', this._onReduced);

    const colours = readColours(o.colourFrom || document.documentElement);
    this.bgCss = cssHex(colours.bg);
    this.grain = makeGrain(colours.grain);
    this.dot = dotBase(colours.bg, colours.dot);

    this._tick = this._tick.bind(this);
    /* Told true when the field starts moving and false when it stops: the
     * plugin sends frame ticks in between. */
    this.onRunning = typeof opts.onRunning === 'function' ? opts.onRunning : null;
    this._fallbackTick = () => {
      if (now() - this.lastOutside > FALLBACK_AFTER_MS) this._tick();
    };
    this.resize();
  }

  /* The size and pixel ratio the canvas needs right now. The ratio includes the
   * editor's CSS scale (see lib/ground-geometry.js): a backing store sized by
   * devicePixelRatio alone is resampled by that scale on screen. */
  _measure() {
    const c = this.canvas;
    const k = viewScale(c.getBoundingClientRect?.(), c.clientWidth);
    return {
      w: c.clientWidth,
      h: c.clientHeight,
      ratio: backingRatio(globalThis.devicePixelRatio || 1, k, this.o.pitch),
    };
  }

  /**
   * Resize if, and only if, the canvas's size or pixel ratio has changed.
   * Returns whether it did. A resize resets the field, so a layout notification
   * that changed nothing must not cost a ring in flight.
   */
  fit() {
    const m = this._measure();
    if (m.w === this.w && m.h === this.h && m.ratio === this.dpr) return false;
    this.resize();
    return true;
  }

  resize() {
    const c = this.canvas;
    const m = this._measure();
    this.w = m.w;
    this.h = m.h;
    /* `dpr` is backing px per layout px -- the device ratio times the editor's
     * scale, snapped so a dot pitch is a whole number of pixels. */
    const dpr = (this.dpr = m.ratio);
    c.width = Math.round(this.w * dpr);
    c.height = Math.round(this.h * dpr);
    this.cols = Math.floor(this.w / this.o.pitch) + 1;
    this.rows = Math.floor(this.h / this.o.pitch) + 1;
    this._grid();
    this._bake();
    this.draw();
  }

  /**
   * The boxes that emit and reflect, in CSS px relative to the canvas.
   * @param rects [{x, y, w, h}]
   */
  setSources(rects) {
    this.rects = rects || [];
    this._grid();
    /* The walls moved, so which cells are drawn moved with them. */
    this.fresh = true;
    this.draw();
  }

  /* The simulation grid: walls (inside a box), sources (open, next to a wall or
   * on the border). Rebuilding this resets the field -- a ring mid-flight
   * through a box that just moved has nowhere consistent to be. */
  _grid() {
    const o = this.o;
    const h = o.cell;
    const nx = (this.nx = Math.floor(this.w / h) + 1);
    const ny = (this.ny = Math.floor(this.h / h) + 1);
    const n = nx * ny;
    this.u = new Float32Array(n);
    this.up = new Float32Array(n);
    this.un = new Float32Array(n);
    const wall = (this.wall = new Uint8Array(n));
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = i * h;
        const y = j * h;
        for (let r = 0; r < this.rects.length; r++) {
          const b = this.rects[r];
          if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
            wall[j * nx + i] = 1;
            break;
          }
        }
      }
    }
    const src = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const q = j * nx + i;
        if (wall[q]) continue;
        const edge = i === 0 || j === 0 || i === nx - 1 || j === ny - 1;
        const near =
          (i > 0 && wall[q - 1]) ||
          (i < nx - 1 && wall[q + 1]) ||
          (j > 0 && wall[q - nx]) ||
          (j < ny - 1 && wall[q + nx]);
        if (near || (o.border && edge)) src.push(q);
      }
    }
    this.src = new Int32Array(src);
    this.kicks = [];
    this.t = 0;
  }

  /** One ring. `s` is 0..1: the plugin sends 1 on a downbeat, 0.4 on a beat. */
  trigger(s) {
    if (this.reduced || !this.enabled || !this.src.length) return;
    this.kicks.push({ t0: this.t, s: clamp(s == null ? 1 : s, 0, 1) });
    this._start();
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!on) this._flatten();
  }

  /** Back to exactly the static ground, now: no wave, no pending kick, no loop. */
  _flatten() {
    this.u.fill(0);
    this.up.fill(0);
    this.kicks = [];
    this._stop();
    this.draw();
  }

  /**
   * One frame, from outside: the plugin's frame tick. Steps the simulation by
   * the time that really passed since the last frame and draws. Ignored at
   * rest.
   */
  tick() {
    this.lastOutside = now();
    if (this.running) this._tick();
  }

  _start() {
    if (this.running) return;
    this.running = true;
    this.lastTick = now();
    this.fallback = globalThis.setInterval(this._fallbackTick, 1000 / this.o.fps);
    this.onRunning?.(true);
  }

  _stop() {
    if (!this.running) return;
    this.running = false;
    globalThis.clearInterval(this.fallback);
    this.fallback = 0;
    this.onRunning?.(false);
  }

  /* One explicit step of the damped wave equation, Neumann at walls and at the
   * border: a neighbour inside a wall is replaced by the cell itself, which is a
   * zero-gradient edge and therefore reflects with no phase flip. */
  _step() {
    const o = this.o;
    const nx = this.nx;
    const ny = this.ny;
    const u = this.u;
    const up = this.up;
    const un = this.un;
    const wall = this.wall;
    const dt = o.dt;
    const k = (o.speed * dt) / o.cell;
    const k2 = k * k;
    const g = ((2 / o.tau) * dt) / 2;
    const a = 1 / (1 + g);
    const b = 1 - g;
    for (let j = 0; j < ny; j++) {
      const row = j * nx;
      for (let i = 0; i < nx; i++) {
        const q = row + i;
        if (wall[q]) {
          un[q] = 0;
          continue;
        }
        const c = u[q];
        const l = i > 0 && !wall[q - 1] ? u[q - 1] : c;
        const r = i < nx - 1 && !wall[q + 1] ? u[q + 1] : c;
        const t = j > 0 && !wall[q - nx] ? u[q - nx] : c;
        const d = j < ny - 1 && !wall[q + nx] ? u[q + nx] : c;
        un[q] = (2 * c - b * up[q] + k2 * (l + r + t + d - 4 * c)) * a;
      }
    }
    /* The sources: the sum of every kick still inside its wavelet. Summing
     * rather than replacing is what makes two kicks interfere instead of the
     * second cancelling the first. */
    let F = 0;
    const live = [];
    const span = 2.5 / o.freq;
    for (let i = 0; i < this.kicks.length; i++) {
      const age = this.t - this.kicks[i].t0;
      if (age < span) {
        F += this.kicks[i].s * ricker(age, o.freq);
        live.push(this.kicks[i]);
      }
    }
    this.kicks = live;
    if (F !== 0) {
      const f = dt * dt * o.gain * F * a;
      const S = this.src;
      for (let i = 0; i < S.length; i++) un[S[i]] += f;
    }
    /* Rotate the three buffers rather than allocating: `un` becomes the present,
     * the present becomes the past, and the old past is the next scratch. */
    this.up = u;
    this.u = un;
    this.un = up;
    this.t += dt;
  }

  _tick() {
    const o = this.o;
    const t = now();
    this.acc += Math.min(0.1, (t - this.lastTick) / 1000);
    this.lastTick = t;
    let n = 0;
    while (this.acc >= o.dt && n < o.maxSteps) {
      this._step();
      this.acc -= o.dt;
      n++;
    }
    /* After a long stall, drop the backlog instead of racing to catch up --
     * which would show as the field suddenly running fast. */
    if (this.acc > o.dt) this.acc = 0;
    const peak = this.draw();
    if (!this.kicks.length && peak <= o.rest) {
      /* Rung out. Back to EXACTLY zero -- not nearly zero -- so every dot is
       * back at its resting sprite, and the clock stops. */
      this.u.fill(0);
      this.up.fill(0);
      this.draw();
      this._stop();
    }
  }

  _peak() {
    let m = 0;
    const u = this.u;
    for (let q = 0; q < u.length; q++) {
      const v = u[q] < 0 ? -u[q] : u[q];
      if (v > m) m = v;
    }
    return m;
  }

  /*
   * THE SPRITE ATLAS is why this can run at 30 fps in a WebView. Every state a
   * cell can be in -- 8x8 grain positions times LEVELS wave values -- is
   * rendered once, up front. A frame then blits the baked ground and one sprite
   * per cell a wave is actually crossing, instead of stroking a few thousand
   * arcs and compositing a noise tile every time.
   */
  _bake() {
    if (!this.w) return;
    const o = this.o;
    const p = o.pitch;
    const dpr = this.dpr;
    const cw = (this.cw = Math.round(p * dpr));
    const A = this.atlas || (this.atlas = document.createElement('canvas'));
    A.width = 64 * cw;
    A.height = LEVELS * cw;
    const x = A.getContext('2d');
    for (let l = 0; l < LEVELS; l++) {
      const v = (l - MID) / MID;
      for (let g = 0; g < 64; g++) {
        const gi = g % 8;
        const gj = (g / 8) | 0;
        // cell-local CSS px, dot at (p/2, p/2)
        x.setTransform(dpr, 0, 0, dpr, g * cw, l * cw);
        x.globalAlpha = 1;
        x.fillStyle = this.bgCss;
        x.fillRect(0, 0, p, p);
        x.globalAlpha = clamp(o.grainBase * (1 + o.grainK * v), o.grainMin, o.grainMax);
        x.drawImage(this.grain, gi * p, gj * p, p, p, 0, 0, p, p);
        x.globalAlpha = clamp(this.dot.alpha * (1 + o.dotDA * v), 0, 1);
        x.fillStyle = this.dot.rgb;
        x.beginPath();
        x.arc(p / 2, p / 2, o.dotR + o.dotDR * v, 0, 2 * Math.PI);
        x.fill();
      }
    }
    const B = this.baked || (this.baked = document.createElement('canvas'));
    B.width = this.canvas.width;
    B.height = this.canvas.height;
    const y = B.getContext('2d');
    y.fillStyle = this.bgCss;
    y.fillRect(0, 0, B.width, B.height);
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) this._blit(y, i, j, MID);
    }
    this.levels = new Uint8Array(this.rows * this.cols);
    this.fresh = true;
  }

  _blit(x, i, j, level) {
    const cw = this.cw;
    const g = (j % 8) * 8 + (i % 8);
    const half = cw / 2;
    x.drawImage(
      this.atlas,
      g * cw, level * cw, cw, cw,
      Math.round(i * cw - half), Math.round(j * cw - half), cw, cw,
    );
  }

  /**
   * Draw the dots whose level changed since the last frame. Returns the peak |u|.
   *
   * ONLY THE CHANGED ONES, which is the whole cost of the ground while music
   * plays. Every sprite covers its own cell exactly -- one pitch square, on
   * whole pixels, opaque -- so redrawing a cell replaces it completely, and a
   * cell that has not changed level is already correct on the canvas. A frame
   * used to copy the whole baked ground and then blit every moving dot again;
   * now a frame where the field is still is no drawing at all.
   *
   * `fresh` forces the full path: after a resize, a rebake or new walls, the
   * canvas is copied from the baked ground once and every level is taken as
   * MID.
   */
  draw() {
    if (!this.baked || !this.u) return 0;
    const x = this.ctx;
    const u = this.u;
    const wall = this.wall;
    const nx = this.nx;
    const cols = this.cols;
    const levels = this.levels;
    const step = Math.round(this.o.pitch / this.o.cell);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1;
    if (this.fresh) {
      x.drawImage(this.baked, 0, 0);
      levels.fill(MID);
      this.fresh = false;
    }
    for (let j = 0; j < this.rows; j++) {
      const gj = j * step;
      if (gj >= this.ny) break;
      for (let i = 0; i < cols; i++) {
        const gi = i * step;
        if (gi >= nx) break;
        const q = gj * nx + gi;
        if (wall[q]) continue;
        const level = Math.round((Math.tanh(u[q]) + 1) * MID);
        const d = j * cols + i;
        if (level !== levels[d]) {
          this._blit(x, i, j, level);
          levels[d] = level;
        }
      }
    }
    return this._peak();
  }

  destroy() {
    this._stop();
    this.kicks = [];
    this._mq?.removeEventListener?.('change', this._onReduced);
  }
}

/* Exported for the tests, which assert against the design's table rather than
 * against whatever this file happens to say. */
export { DEFAULTS, LEVELS, MID };
