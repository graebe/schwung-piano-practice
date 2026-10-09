// Copied from neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/src/components/Ground.jsx), MIT, Torben Gräber.
/*
 * The window's animated ground.
 * Copyright (c) 2026 Torben Gräber. MIT.
 *
 * THE DESIGN SYSTEM GIVES EVERY WINDOW ONE OF THESE, and it is the only thing in
 * the whole system that animates. `lib/field.js` is the simulation, ported from
 * the design's own reference; this file is the four things a Solid editor has to
 * do around it: own the canvas, keep the field's idea of the window's size and
 * boxes current, pass the Motion switch through, and stop cleanly.
 *
 * WHERE IT GOES. First child of the window element, which in this repository is
 * each editor's `<main>`. It is `position: absolute; inset: 0` with `z-index: 0`,
 * so it fills the window and everything else paints over it -- see the `.ground`
 * rule in components.css, and the note there about the one thing each editor's
 * app.css has to provide.
 *
 * THE SOURCES ARE MEASURED FROM THE DOM, not declared. The design says the boxes
 * that emit and reflect are the panels, grids, wells and rings the window
 * happens to contain, so asking the document is the statement that stays true
 * when a layout changes. A selector list is overridable because the editors do
 * not agree on class names -- the Spectrogram's picture is a `.spectro`, the
 * Side-Chain's is a `.plot` -- and a box the field should respect but that
 * matches nothing gets `data-wave-source`.
 *
 * WHY A ResizeObserver AND NOT A WINDOW RESIZE LISTENER. Two of these editors
 * resize themselves from the UI (the Trance Gate grows with its rows, the
 * Side-Chain with its shaper) by telling the plugin to resize the host window.
 * That changes `main`'s box without necessarily firing a window resize the
 * canvas would see in the right order, and a field whose grid disagrees with its
 * canvas draws the ground at the wrong pitch. Observing the element asks about
 * the thing that actually matters.
 *
 * AND WHY THAT IS NOT ENOUGH ON ITS OWN. Every editor here also scales its
 * <main> with a CSS transform to fit the viewport, and a transform is not a
 * resize: the ResizeObserver never hears about it. So the element's `style` is
 * watched as well (that is where each editor writes its scale), and the window's
 * resize, which is how a devicePixelRatio or zoom change arrives. All of it is
 * coalesced into one re-measure, on a timer rather than an animation frame: a
 * plugin host shows this page as hidden, and WebKit all but stops a hidden
 * page's animation frames (lib/field.js says more).
 *
 * WHAT IT DOES NOT DO: idle. There is no animation loop running when nothing has
 * happened -- `Field` stops its own clock once the field is at rest, and at rest
 * the canvas shows the static design.
 */

import { onMount, onCleanup, createEffect } from 'solid-js';

import { Field } from '../lib/field.js';
import { viewScale, toCanvasRects, sameRects } from '../lib/ground-geometry.js';

/*
 * The boxes that emit and reflect, by default.
 *
 * `.panel` and `.plot` are this repository's spellings of the design system's
 * `.ph-panel` and its wells; `[data-wave-source]` is the escape hatch for a box
 * that is one of these in the design's sense but does not carry the class.
 */
const DEFAULT_SOURCES = '.panel, .plot, .well, .grid, .ring, [data-wave-source]';

/**
 * @param props.enabled   the Motion switch. Default true.
 * @param props.sources   a selector list for the emitting/reflecting boxes.
 * @param props.ref       called with a handle: `{ trigger(strength) }`.
 */
export function Ground(props) {
  let canvas;
  let field = null;
  let observer = null;
  let mutations = null;
  let dprQuery = null;
  let pending = 0;
  let rects = null;
  /* Who is told when the field starts and stops moving: the bridge, which
   * asks the plugin for frame ticks in between. */
  let reportRunning = null;

  /*
   * Measure the boxes RELATIVE TO THE CANVAS AND IN ITS LAYOUT PX. Both rects
   * come from getBoundingClientRect, which is on-screen px -- AFTER the editor's
   * scale transform -- while the field simulates in the canvas's clientWidth,
   * which is before it. So the difference is divided by that scale on the way
   * in (lib/ground-geometry.js); without that, at any scale but 1 the walls
   * were not where the panels are.
   *
   * An unchanged layout is not passed on: `setSources` rebuilds the grid, which
   * resets the field, and a style write that moved nothing must not cost a ring.
   */
  const measure = () => {
    if (!field || !canvas) return;
    const root = canvas.parentElement;
    if (!root) return;
    const base = canvas.getBoundingClientRect();
    const k = viewScale(base, canvas.clientWidth);
    const selector = props.sources || DEFAULT_SOURCES;
    const next = toCanvasRects(
      base,
      Array.from(root.querySelectorAll(selector), (el) => el.getBoundingClientRect()),
      k,
    );
    if (sameRects(next, rects)) return;
    rects = next;
    field.setSources(next);
  };

  /* Everything that can move the layout, the scale or the pixel ratio lands
   * here, once per burst of notifications. `fit` rebuilds only if the canvas's size or
   * ratio really changed; a rebuild clears the walls, so they are re-sent. */
  const update = () => {
    pending = 0;
    if (!field) return;
    if (field.fit()) rects = null;
    measure();
  };
  const schedule = () => {
    if (!pending && field) pending = globalThis.setTimeout(update, 0);
  };

  /* A devicePixelRatio change -- the window dragged to another screen, a zoom --
   * is a media query flipping. It is re-armed at the new ratio each time. */
  const watchDpr = () => {
    dprQuery?.removeEventListener?.('change', onDpr);
    dprQuery = globalThis.matchMedia?.(`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`) || null;
    dprQuery?.addEventListener?.('change', onDpr);
  };
  function onDpr() {
    watchDpr();
    schedule();
  }

  /* The field is built once the document's stylesheets have applied, and not
   * before: see `onMount`. */
  let disposed = false;
  const start = () => {
    globalThis.removeEventListener?.('load', start);
    if (disposed || field) return;
    /*
     * THE GROUND MAY NEVER TAKE THE EDITOR DOWN WITH IT, and that is not
     * defensive habit -- it is a specific failure this had.
     *
     * Solid mounts children before parents, so this runs BEFORE the editor's own
     * onMount. A throw here -- a token missing from the stylesheet, a WebView
     * that refuses a 2D context or `createImageData` -- would therefore stop the
     * editor from ever registering `onMessage`, and the window would render once
     * and then sit there completely dead: no meters, no readouts, no parameter
     * updates, and nothing on screen to say why.
     *
     * That is a catastrophic price for a decoration. The design system already
     * names the fallback: the static CSS ground on `body`, which this canvas
     * merely draws over. So a failure here leaves the canvas transparent, the CSS
     * ground showing through it, and the editor entirely intact.
     *
     * The console line is the whole diagnosis, and it is enough: the review
     * harness and a WebView inspector both show it, and `field.js` still THROWS
     * on a missing token rather than guessing, so ui-kit/test/field.test.mjs
     * catches a stylesheet bug long before a plugin gets here.
     */
    try {
      field = new Field(canvas, { onRunning: (on) => reportRunning?.(on) });
      /* The field's own constructor sizes itself and paints the ground at rest,
       * so there is a correct picture before any of the below runs. */
      measure();
    } catch (err) {
      field = null;
      console.error('Ground: the animated background is off -', err);
    }

    const root = canvas.parentElement;
    if (field && root && globalThis.ResizeObserver) {
      /*
       * ONE OBSERVER ON THE WINDOW, NOT ONE PER BOX. What the field needs is to
       * be told "the layout moved"; which box moved does not change the work,
       * because `measure` re-reads all of them anyway. Observing `main` catches
       * a host resize, and observing the boxes as well would only add callbacks
       * that do the same thing several times in one frame.
       */
      observer = new ResizeObserver(schedule);
      observer.observe(root);
    }
    if (field && root && globalThis.MutationObserver) {
      /* THE SCALE. Each editor writes `transform: scale(k)` into main's inline
       * style, and nothing else reports that. Solid mounts this before the
       * editor's own onMount applies the first scale, so this is also what
       * catches the initial one. */
      mutations = new MutationObserver(schedule);
      mutations.observe(root, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    if (field) {
      globalThis.addEventListener?.('resize', schedule);
      watchDpr();
      field.setEnabled(props.enabled ?? true);
    }
  };

  onMount(() => {
    /*
     * NOT BEFORE THE STYLESHEET. The field reads its three colours from
     * tokens.css, and a module script is not guaranteed to run after the
     * page's stylesheet has applied: in a plugin host under load the editor
     * mounted first, the tokens read empty, the field refused to start (as it
     * must on a missing token) and the background was dead for the whole
     * session. The window's `load` comes after every stylesheet; until then
     * the static CSS ground is what shows, which is also what a field at rest
     * draws.
     */
    if (globalThis.document?.readyState === 'complete') start();
    else globalThis.addEventListener?.('load', start);

    props.ref?.({
      /* The only way in. A ring arrives as a message from the plugin -- one a
       * beat while the host plays -- and the editor hands its strength
       * straight through. */
      trigger: (strength) => field?.trigger(strength),
      /* The plugin's frame tick: the field's clock while it moves. */
      tick: () => field?.tick(),
      /* `fn(running)` when the field starts and stops moving. */
      onRunning: (fn) => { reportRunning = fn; },
    });
  });

  /* The Motion switch. `enabled` defaults to true so that a window which has not
   * wired one still shows the design's ground rather than a dead canvas --
   * though the design does require the switch, and every editor here has one. */
  createEffect(() => {
    const on = props.enabled ?? true;
    field?.setEnabled(on);
  });

  onCleanup(() => {
    disposed = true;
    globalThis.removeEventListener?.('load', start);
    observer?.disconnect();
    observer = null;
    mutations?.disconnect();
    mutations = null;
    globalThis.removeEventListener?.('resize', schedule);
    dprQuery?.removeEventListener?.('change', onDpr);
    dprQuery = null;
    if (pending) globalThis.clearTimeout(pending);
    pending = 0;
    field?.destroy();
    reportRunning = null;
    field = null;
  });

  /*
   * aria-hidden, and it is not laziness. The ground carries no information -- it
   * is the same picture whatever the plugin is doing, and its only content is
   * the song's beat, which the user can hear. A screen reader announcing a
   * canvas here would be announcing decoration.
   */
  return <canvas class="ground" ref={canvas} aria-hidden="true" />;
}
