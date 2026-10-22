// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * The practice chart: a grand staff the music scrolls along, right to left,
 * past a fixed hit line.
 *
 * A port of the plugin kit's GrandStaff (plugins/_shared/ui/src/GrandStaff.cpp)
 * from a record of what was played to a chart of what is to be played:
 *
 *   staves      line-200; the treble's top line F5, the bass's A3, seven
 *               spaces apart (staff.js has the geometry)
 *   clefs, key  NI Notation (Bravura), ink-muted, in a gutter at the left that
 *   and time    does not scroll; the key is the one in force at the hit line
 *   bar lines   line-200 across both staves, a little before each downbeat
 *   hit line    uv with glow-led: where the music is now
 *   a note      PROPORTIONAL, as the kit's: a head where it starts and a 2px
 *               tail for as long as it lasts, no stems, flags or rests
 *     pending   ink head, line-200 tail
 *     now       uv head with glow-led, uv-deep tail: it is on the hit line
 *     hit       an open head, uv with glow-led: right, and on time
 *     good      an open head, uv: right
 *     late      an open head, ink-muted: right, but late
 *     missed    an x head, red
 *   accidental  where the note differs from the key signature (a natural
 *               cancels one), in its head's colour
 *   markers     where the player actually played: a small ring in ink-muted
 *               (red for a stray), so the gap to the head is the timing error
 *   names       under the staves, each beat's notes or chord symbol in the hint
 *               style; ink-muted, ink while on the hit line
 *   waiting     the note the scroll waits on (blockingIndex): its heads lit,
 *               its name a lit chip -- uv fill, on-uv text, glow-led
 *
 * MOVES WITHOUT RE-RENDERING. The notes are laid out once per change of
 * `events` or `judgements`, in beats along a group that one requestAnimationFrame
 * loop translates by -beats * pxPerBeat. Per frame that is one attribute
 * write; a Solid update happens only when a note reaches or leaves the hit
 * line, or the key there changes. With a constant `beats` there is no loop at
 * all: the chart is drawn once, still, for a screenshot.
 *
 * Props:
 *   events        [{ beat, durBeats, pitches, hand?, symbol?, index?, spelled? }],
 *                 beat order, as in an exercise file; `index` (default:
 *                 position) is what judgements and blockingIndex refer to;
 *                 `spelled` [{ step, alteration, letter }] by pitch places
 *                 notes by letter instead of by the key (C-Eb, not C-D#)
 *   judgements    by index: a state for every note of the event, or an array
 *                 of states parallel to its pitches; 'pending' | 'hit' |
 *                 'good' | 'late' | 'missed' (absent: pending)
 *   markers       [{ beat, pitch, hand?, stray? }]
 *   fifths        the key signature, -7..7 (default 0)
 *   keyChanges    [{ beat, keySig }], as a chart carries them
 *   spelling      a generated drill's scale spelling (chart.spelling), so C
 *                 minor reads Eb and C harmonic minor B natural
 *   timeSig       [numerator, denominator] (default [4, 4]); null draws none
 *   pxPerBeat     default 8 staff spaces
 *   hitX          the hit line, as a fraction of the width (default 0.25)
 *   beats         the song position: a function, called every animation frame
 *                 while mounted, or a number for a still chart
 *   showNames     the name lane (default true)
 *   blockingIndex the event the scroll waits on, or null
 *   hitLine       draw the hit line (default true); off for a bare staff
 *   barLines      draw bar lines (default true); off where there is no metre,
 *                 as in a quiz's row of prompts
 *   space         the staff space in px (default 10)
 *   label         its accessible name (default "Notation")
 */
import { For, Index, Show, createMemo, createSignal, createEffect, onCleanup, onMount, untrack } from 'solid-js';
import { fifthsAt, keyAt, beatsPerBar, chartTotalBeats } from '../../../src/chart.mjs';
import * as S from './staff.js';

const JUDGED = new Set(['hit', 'good', 'late', 'missed']);
/* Hint text: 10px at JetBrains Mono's 0.6em advance, tracked 0.02em. */
const HINT_ADVANCE = 6.2;

const head = (state) => (state === 'missed' ? S.GLYPH.noteheadX
  : JUDGED.has(state) ? S.GLYPH.noteheadHalf : S.GLYPH.noteheadBlack);

let instances = 0;

export function GrandStaff(props) {
  const clip = `staff-lane-${++instances}`;
  let box;
  let lane;
  const [width, setWidth] = createSignal(0);
  const [nowKey, setNowKey] = createSignal('');
  const [keyHere, setKeyHere] = createSignal(null);

  const space = () => props.space ?? 10;
  const ppb = () => props.pxPerBeat ?? 8 * space();
  /* A bar line stands a little before its downbeat, clear of the head. */
  const barOffset = () => Math.min(1.6 * space(), 0.4 * ppb());
  const showNames = () => props.showNames ?? true;
  /* null draws no time signature; the bars still need one. */
  const timeSig = () => (props.timeSig === null ? null : props.timeSig ?? [4, 4]);
  const events = () => props.events ?? [];
  const chart = createMemo(() => ({
    keySig: props.fifths ?? 0, keyChanges: props.keyChanges, timeSig: timeSig() ?? [4, 4], events: events(),
    spelling: props.spelling ?? null,
  }));
  const sys = createMemo(() => S.systemLayout(space(), { below: 2.5, names: showNames() ? 24 : 0 }));
  const em = () => S.EM * space();

  /* The gutter is as wide as the widest signature in the piece, so the hit
   * line does not move when the key does. */
  const widestKey = createMemo(() => Math.max(Math.abs(props.fifths ?? 0),
    ...(props.keyChanges ?? []).map((k) => Math.abs(k.keySig))));
  const gutter = createMemo(() => S.gutter(widestKey(), timeSig()));
  const gutterPx = () => Math.round(gutter().end * space());
  const hitPx = () => Math.max(gutterPx() + space(), Math.round((props.hitX ?? 0.25) * width()));
  const keyNow = () => keyHere() ?? (props.fifths ?? 0);

  /* ---------------------------------------------------------- the notes */

  const judgement = (index, j) => {
    const g = props.judgements?.[index];
    const s = Array.isArray(g) ? g[j] : g;
    return s ?? 'pending';
  };

  /* Each event laid out in px along the lane, at beat 0 = x 0. */
  const laid = createMemo(() => {
    const L = sys();
    const sp = space();
    const headW = S.advance(S.GLYPH.noteheadBlack) * sp;
    const p = ppb();
    return events().map((ev, pos) => {
      const index = ev.index ?? pos;
      const fifths = fifthsAt(chart(), ev.beat);
      const key = keyAt(chart(), ev.beat);
      const x = ev.beat * p;
      const notes = ev.pitches.map((pitch, j) => {
        const w = ev.spelled?.[j] ?? S.written(pitch, key);
        const staff = S.staffOf(w.step, ev.hand);
        const acc = S.accidentalFor(w.alteration, w.letter, fifths);
        return { pitch, j, ...w, staff, y: L.y(w.step, staff), acc, state: judgement(index, j) };
      });
      for (const staff of ['treble', 'bass']) {
        const on = notes.filter((n) => n.staff === staff);
        const shifts = S.secondShifts(on.map((n) => n.step));
        on.forEach((n, k) => { n.dx = shifts[k] ? headW : 0; });
        const withAcc = on.filter((n) => n.acc !== null);
        const cols = S.accidentalColumns(withAcc.map((n) => n.step));
        withAcc.forEach((n, k) => {
          n.ax = -headW / 2 - (S.ACCIDENTAL_GAP + S.advance(n.acc) + cols[k] * 1.2) * sp;
        });
      }
      /* Ledger lines once per step and staff, wide enough for a shifted head. */
      const ledgers = [];
      for (const staff of ['treble', 'bass']) {
        const on = notes.filter((n) => n.staff === staff);
        const steps = new Set(on.flatMap((n) => S.ledgerSteps(n.step, staff)));
        const wide = on.some((n) => n.dx > 0);
        for (const s of steps) ledgers.push({ y: L.y(s, staff), wide });
      }
      return {
        index, pos, ev, x, notes, ledgers, headW,
        tail: Math.max(0, (ev.durBeats ?? 1) * p - headW / 2),
        judged: notes.every((n) => JUDGED.has(n.state)),
      };
    });
  });

  /* The beats with a name under them: one per beat, the events on it merged
   * (both hands of one chord), a chord symbol taking precedence. */
  const names = createMemo(() => {
    const byBeat = new Map();
    for (const e of laid()) {
      const at = byBeat.get(e.ev.beat) ?? { beat: e.ev.beat, x: e.x, pitches: [], symbol: null, indices: [] };
      at.pitches.push(...e.ev.pitches);
      at.symbol = at.symbol ?? e.ev.symbol ?? null;
      at.indices.push(e.index);
      byBeat.set(e.ev.beat, at);
    }
    const list = [...byBeat.values()].sort((a, b) => a.beat - b.beat);
    return list.map((n, i) => {
      const text = S.noteLabel(n.pitches, keyAt(chart(), n.beat), n.symbol);
      const room = i + 1 < list.length ? list[i + 1].x - n.x - 4 : Infinity;
      const chars = Math.max(1, Math.floor(room / HINT_ADVANCE));
      return { ...n, text: text.length > chars ? `${text.slice(0, Math.max(1, chars - 1))}…` : text };
    });
  });

  const bars = createMemo(() => {
    if (props.barLines === false) return [];
    const per = beatsPerBar(chart());
    const total = chartTotalBeats(chart());
    const off = barOffset();
    const out = [];
    for (let b = per; b <= total + 1e-9; b += per) out.push(Math.round(b * ppb() - off));
    return out;
  });

  /* Key changes inside the lane: the new signature (or the naturals that
   * cancel the old one) just before the bar line it starts at, so it reads
   * before the notes it governs and never sits on them. */
  /*
   * A key change inside the lane is marked as engraving marks it — a double
   * bar line where it starts — with the new key named above the staff. The
   * full signature is drawn only in the gutter, once the change reaches the
   * hit line: a signature in the lane needs room the notes around it do not
   * leave at any brisk tempo, and drew over them.
   */
  const keyMarks = createMemo(() => {
    const list = [];
    for (const k of props.keyChanges ?? []) {
      if (k.beat <= 0 || k.keySig === undefined) continue;
      list.push({ x: Math.round(k.beat * ppb() - barOffset()), label: S.keyName(k.keySig) });
    }
    return list;
  });

  const markerStaff = (m, step) => {
    if (m.hand) return S.staffOf(step, m.hand);
    let best = null;
    for (const e of events()) {
      if (!e.hand || !e.pitches.includes(m.pitch)) continue;
      const d = Math.abs(e.beat - m.beat);
      if (d <= 2 && (!best || d < best.d)) best = { d, hand: e.hand };
    }
    return S.staffOf(step, best?.hand);
  };
  const markers = createMemo(() => (props.markers ?? []).map((m) => {
    const w = S.written(m.pitch, keyAt(chart(), m.beat));
    return { x: m.beat * ppb(), y: sys().y(w.step, markerStaff(m, w.step)), stray: !!m.stray };
  }));

  /* ------------------------------------------------------ the clock */

  /* What is on the hit line: every event whose span holds the position. */
  const spans = createMemo(() => laid().map((e) => [e.ev.beat, e.ev.beat + Math.max(e.ev.durBeats ?? 1, 0.25), e.index]));
  const nowSet = createMemo(() => new Set(nowKey() ? nowKey().split(',').map(Number) : []));

  const place = (b) => {
    if (lane) {
      const dpr = globalThis.devicePixelRatio || 1;
      const tx = Math.round((hitPx() - b * ppb()) * dpr) / dpr;
      lane.setAttribute('transform', `translate(${tx} 0)`);
    }
    const on = [];
    for (const [from, to, index] of spans()) {
      if (from > b + 1e-6) break;
      if (b < to) on.push(index);
    }
    const key = on.join(',');
    if (key !== nowKey()) setNowKey(key);
    const f = fifthsAt(chart(), b);
    if (f !== keyHere()) setKeyHere(f);
  };

  onMount(() => {
    setWidth(box.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(box);
    onCleanup(() => ro.disconnect());
  });

  /* Still, or moving: a constant is placed whenever it or the layout changes,
   * a function every frame. */
  createEffect(() => {
    const beats = props.beats;
    width(); laid();
    if (typeof beats !== 'function') {
      untrack(() => place(Number(beats ?? 0)));
      return;
    }
    let raf = 0;
    const frame = () => {
      untrack(() => place(beats()));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    onCleanup(() => cancelAnimationFrame(raf));
  });

  /* ------------------------------------------------------ drawing */

  const stateOf = (e, n) => {
    if (n.state !== 'pending') return n.state;
    if (e.index === props.blockingIndex || nowSet().has(e.index)) return 'now';
    return 'pending';
  };
  const glyph = (cp) => S.char(cp);
  const lineRect = (y, x0, x1) => ({ x: x0, y, width: Math.max(0, x1 - x0), height: 1 });

  return (
    <div ref={box} class="staff">
      <svg width={width()} height={sys().height} viewBox={`0 0 ${width()} ${sys().height}`}
           role="img" aria-label={props.label ?? 'Notation'}>
        <defs>
          <clipPath id={clip}>
            <rect x={gutterPx()} y="0" width={Math.max(0, width() - gutterPx())} height={sys().height} />
          </clipPath>
        </defs>

        {/* The ten lines, across the whole width. */}
        <g class="staff-lines" shape-rendering="crispEdges">
          <For each={['treble', 'bass']}>{(staff) => (
            <For each={S.staffLines(staff)}>{(step) => (
              <rect {...lineRect(sys().y(step, staff), Math.round(S.CLEF_X * space() / 2), width())} />
            )}</For>
          )}</For>
          {/* The system's left edge, joining the staves. */}
          <rect x={Math.round(S.CLEF_X * space() / 2)} y={sys().trebleTop} width="1"
                height={sys().bassBottom - sys().trebleTop + 1} />
        </g>

        {/* The gutter: clefs, the key at the hit line, the time. */}
        <g class="staff-gutter notation" font-size={em()}>
          <text x={S.CLEF_X * space()} y={sys().y(S.G_CLEF_STEP, 'treble')}>{glyph(S.GLYPH.gClef)}</text>
          <text x={S.CLEF_X * space()} y={sys().y(S.F_CLEF_STEP, 'bass')}>{glyph(S.GLYPH.fClef)}</text>
          <For each={['treble', 'bass']}>{(staff) => (
            <Index each={S.keySignature(keyNow(), staff)}>{(k) => (
              <text x={(S.SIGNATURE_X + k().x) * space()} y={sys().y(k().step, staff)}>{glyph(k().glyph)}</text>
            )}</Index>
          )}</For>
          <Show when={gutter().timeX !== null}>
            <For each={[['treble', 36, 32], ['bass', 24, 20]]}>{([staff, upper, lower]) => (
              <>
                <text x={(gutter().timeX + (gutter().timeWidth - S.timeSigWidth(timeSig()[0])) / 2) * space()}
                      y={sys().y(upper, staff)}>{S.timeSigText(timeSig()[0])}</text>
                <text x={(gutter().timeX + (gutter().timeWidth - S.timeSigWidth(timeSig()[1])) / 2) * space()}
                      y={sys().y(lower, staff)}>{S.timeSigText(timeSig()[1])}</text>
              </>
            )}</For>
          </Show>
        </g>

        {/* The lane: everything in it is placed in beats and moves together. */}
        <g clip-path={`url(#${clip})`}>
          <g ref={lane}>
            <g class="staff-bars" shape-rendering="crispEdges">
              <For each={bars()}>{(x) => (
                <rect x={x} y={sys().trebleTop} width="1" height={sys().bassBottom - sys().trebleTop + 1} />
              )}</For>
            </g>

            <g class="staff-keychange">
              <For each={keyMarks()}>{(m) => (
                <g>
                  <rect x={m.x - 3} y={sys().trebleTop} width="1" height={sys().bassBottom - sys().trebleTop + 1} />
                  <rect x={m.x} y={sys().trebleTop} width="1" height={sys().bassBottom - sys().trebleTop + 1} />
                  <text class="t-hint" x={m.x + 4} y={sys().trebleTop - 0.8 * space()}>{m.label}</text>
                </g>
              )}</For>
            </g>

            <Index each={laid()}>{(e) => (
              <g class="staff-event" classList={{ waiting: e().index === props.blockingIndex }}>
                <For each={e().notes}>{(n) => (
                  <rect class={`staff-tail ${stateOf(e(), n)}`} x={e().x} y={n.y - 1}
                        width={e().tail} height="2" />
                )}</For>
                <g class="staff-ledgers" shape-rendering="crispEdges">
                  <For each={e().ledgers}>{(l) => (
                    <rect x={Math.round(e().x - e().headW / 2 - S.LEDGER_OVER * space())} y={l.y}
                          width={Math.round(e().headW * (l.wide ? 2 : 1) + 2 * S.LEDGER_OVER * space())} height="1" />
                  )}</For>
                </g>
                <g class="notation" font-size={em()}>
                  <For each={e().notes}>{(n) => (
                    <g class={`staff-note ${stateOf(e(), n)}`}>
                      <text x={e().x - e().headW / 2 + n.dx} y={n.y}>{glyph(head(stateOf(e(), n)))}</text>
                      <Show when={n.acc !== null}>
                        <text x={e().x + n.ax} y={n.y}>{glyph(n.acc)}</text>
                      </Show>
                    </g>
                  )}</For>
                </g>
              </g>
            )}</Index>

            <g class="staff-markers">
              <For each={markers()}>{(m) => (
                <circle classList={{ 'staff-marker': true, stray: m.stray }} cx={m.x} cy={m.y} r={space() * 0.32} />
              )}</For>
            </g>

            <Show when={showNames()}>
              <g class="staff-names">
                <For each={names()}>{(n) => {
                  const waiting = () => n.indices.includes(props.blockingIndex);
                  const now = () => n.indices.some((i) => nowSet().has(i));
                  return (
                    <g classList={{ 'staff-name': true, now: now(), waiting: waiting() }}>
                      <Show when={waiting()}>
                        <rect class="staff-chip" x={Math.round(n.x - (n.text.length * HINT_ADVANCE) / 2 - 6)}
                              y={sys().nameY + 2} height="18"
                              width={Math.round(n.text.length * HINT_ADVANCE + 12)} />
                      </Show>
                      <text class="t-hint" x={n.x} y={sys().nameY + 15} text-anchor="middle">{n.text}</text>
                    </g>
                  );
                }}</For>
              </g>
            </Show>
          </g>
        </g>

        {/* The hit line, over the lane: where the music is now. */}
        <Show when={props.hitLine ?? true}>
        <rect class="staff-hit" x={hitPx() - 1} y={sys().trebleTop - space()} width="2"
              height={sys().bassBottom - sys().trebleTop + 2 * space() + 1} />
        </Show>
      </svg>
    </div>
  );
}
