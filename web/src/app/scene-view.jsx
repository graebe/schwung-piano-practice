// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * scene-view.jsx — a scene of the Learning Path (the session's scenes), on
 * the page as on the Move: the walk, the flag going up, fireworks, the
 * banner and the finale drawn by the same engine (pathmap/anim.mjs) into a
 * recording ctx whose shapes become SVG; the zoom as a CSS transform of the
 * map it lands on; a level learned as the panel shows it: the score, big,
 * a star round it and LEVEL LEARNED under it (view.mjs drawStarBand).
 *
 * The page keeps its own clock for the scene, set from the session's
 * progress when the scene first arrives, so it plays smoothly however late
 * each picture comes. Any click or key skips it, as any key does on the Move.
 */
import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { Button } from '../kit/components/Button.jsx';
import { layoutPlaces, cellCentre, MAP_X, MAP_Y, MAP_W, MAP_H } from '../../../src/pathmap/layout.mjs';
import { createWalk, walkTo, STORY_MS_PER_CELL } from '../../../src/pathmap/walk.mjs';
import { drawMap } from '../../../src/pathmap/render.mjs';
import { flagRise, fireworks, banner, finale, FLAG_MS } from '../../../src/pathmap/anim.mjs';
import { drawStarBand } from '../../../src/view.mjs';

/* What the engine draws, as shapes: rectangles, lines and the banner's words. */
function recorder() {
  const shapes = [];
  const ctx = {
    fillRect: (x, y, w, h, v) => shapes.push({ k: 'r', x, y, w, h, v }),
    line: (x0, y0, x1, y1, v) => shapes.push({ k: 'l', x0, y0, x1, y1, v }),
    text: (x, y, s, v) => shapes.push({ k: 't', x, y, s: String(s), v }),
    textWidth: (s) => String(s).length * 6 - 1,
  };
  return { ctx, shapes };
}

function Shapes(props) {
  return (
    <For each={props.shapes}>{(s) => (s.k === 'r'
      ? <rect x={s.x} y={s.y} width={s.w} height={s.h} class={s.v ? 'ink' : 'sea'} />
      : s.k === 'l'
        ? <line x1={s.x0 + 0.5} y1={s.y0 + 0.5} x2={s.x1 + 0.5} y2={s.y1 + 0.5} class="ink-line" />
        : <text x={s.x} y={s.y + 6} class={s.v ? 'ink-text' : 'sea-text'}>{s.s}</text>)}</For>
  );
}

const sceneKey = (a) => [a.kind, a.dir, a.at, a.from, a.to, a.text, a.over].join('|');

export function AnimView(props) {
  const a = () => props.vm().anim;
  const [frame, setFrame] = createSignal(performance.now());
  let key = '';
  let start = 0;
  let walk = null;
  /* ms into the scene on the page's clock, started from the session's
   * progress when the scene arrived. */
  const t = () => {
    const an = a();
    const k = sceneKey(an);
    if (k !== key) {
      key = k;
      start = performance.now() - an.progress * an.ms;
      walk = null;
    }
    return Math.max(0, Math.min(an.ms, frame() - start));
  };
  let raf = 0;
  const loop = () => {
    setFrame(performance.now());
    raf = requestAnimationFrame(loop);
  };
  onMount(() => { raf = requestAnimationFrame(loop); });
  onCleanup(() => cancelAnimationFrame(raf));

  const layout = () => layoutPlaces(a().places ? a().places.length : 0, { kind: a().world ? 'world' : 'island' });
  const shapes = () => {
    const an = a();
    const tt = t();
    const l = layout();
    const { ctx, shapes: out } = recorder();
    if (!an.places || !l.cells.length) return out;
    const at = Math.min(an.at || 0, l.cells.length - 1);
    if (an.kind === 'walk') {
      if (!walk || walk.layout !== l) {
        walk = createWalk(l, an.from, { msPerCell: STORY_MS_PER_CELL });
        walkTo(walk, an.to, start);
      }
      drawMap(ctx, { places: an.places, layout: l, walk, now: frame() });
    } else if (an.kind === 'celebrate' && tt < FLAG_MS) {
      const places = an.places.slice();
      places[at] = { ...places[at], state: an.was || 'started' };
      drawMap(ctx, { places, layout: l, walk: createWalk(l, at), now: frame() });
      flagRise(ctx, { layout: l, index: at, place: an.places[at] }, tt);
    } else if ((an.kind === 'celebrate' && an.fireworks) || an.kind === 'banner') {
      drawMap(ctx, { places: an.places, layout: l, walk: createWalk(l, at), now: frame(), route: false });
      if (an.kind === 'banner') banner(ctx, { text: an.text }, tt);
      else {
        const c = cellCentre(l.cells[at], l.kind);
        fireworks(ctx, { x: c.x, y: c.y, seed: at + 1 }, tt - FLAG_MS);
      }
    } else if (an.kind === 'finale') {
      finale(ctx, { layout: l, places: an.places, seed: 7 }, tt);
    } else {
      drawMap(ctx, { places: an.places, layout: l, walk: createWalk(l, at), now: frame() });
    }
    return out;
  };

  /* The zoom: the map it lands on, scaled about the island's cell on the
   * world, in (from small) or out (from large). */
  const origin = () => {
    const an = a();
    const world = layoutPlaces(an.zoomFrom.count, { kind: 'world' });
    const c = cellCentre(world.cells[an.zoomAt], 'world');
    return `${((c.x - MAP_X) / MAP_W) * 100}% ${((c.y - MAP_Y) / MAP_H) * 100}%`;
  };

  const skip = () => props.dispatch({ type: 'skip' });
  return (
    <Show when={a().over !== 'result' || !props.vm().result} fallback={
      <section class="screen anim-screen anim-over" aria-labelledby="anim-title" data-kind={a().kind}
               data-info="Any click or key skips it" onClick={skip}>
        <header class="screen-head">
          <h1 id="anim-title" class="t-title">{a().say}</h1>
          <p class="t-hint">Any key or click skips it.</p>
        </header>
        <div class="anim-stage">
          <svg class="map anim-star" viewBox={`0 ${MAP_Y} 128 ${MAP_H}`} shape-rendering="crispEdges" aria-hidden="true">
            <Shapes shapes={(() => {
              const { ctx, shapes: out } = recorder();
              drawStarBand(ctx, props.vm().result, t());
              return out;
            })()} />
          </svg>
        </div>
        <Button onClick={(e) => { e.stopPropagation(); skip(); }}>Skip</Button>
      </section>
    }>
      <section class="screen anim-screen" aria-labelledby="anim-title" data-kind={a().kind}
               data-info="Any click or key skips it" onClick={skip}>
        <header class="screen-head">
          <h1 id="anim-title" class="t-title">{a().say || a().text || ''}</h1>
          <p class="t-hint">Any key or click skips it.</p>
        </header>
        <div class="anim-stage">
          <Show when={a().kind === 'zoom'} fallback={
            <svg class="map" viewBox={`${MAP_X} ${MAP_Y} ${MAP_W} ${MAP_H}`} shape-rendering="crispEdges" aria-hidden="true">
              <Shapes shapes={shapes()} />
            </svg>
          }>
            <svg class={`map anim-zoom anim-zoom-${a().dir}`} viewBox={`${MAP_X} ${MAP_Y} ${MAP_W} ${MAP_H}`}
                 shape-rendering="crispEdges" aria-hidden="true"
                 style={{ 'transform-origin': origin(), 'animation-delay': `-${Math.round(a().progress * a().ms)}ms` }}>
              <Shapes shapes={(() => {
                const { ctx, shapes: out } = recorder();
                const l = layout();
                if (l.cells.length) drawMap(ctx, { places: a().places, layout: l, walk: createWalk(l, a().at || 0), now: 0 });
                return out;
              })()} />
            </svg>
          </Show>
        </div>
        <Button onClick={(e) => { e.stopPropagation(); skip(); }}>Skip</Button>
      </section>
    </Show>
  );
}
