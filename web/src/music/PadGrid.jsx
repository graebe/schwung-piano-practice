// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * Move's pad grid: four rows of eight, one semitone to the right and five up
 * a row, as the module plays it (src/padmap.mjs). What each pad shows is
 * pads.js's to decide; this draws it and, when `playable`, plays it.
 *
 * Pads are steps in the system's terms -- a square well of `step` (40px) on
 * the grid's space-2 gap, rounded by radius-1, the softening the system allows
 * a housing -- and shrink, never grow, to fit a narrow window.
 *
 * Props:
 *   transpose   the grid's transpose (default +12, padmap's)
 *   rootPc      the key's root pitch class; null for no key colouring
 *   intervals   the scale above the root (default major)
 *   states      pitch -> 'coming' | 'now' | 'held' | 'hit' | 'miss'
 *   answers     [{ label, key?, struck? }] -- the answer bar (answer_pads.mjs)
 *   fifths      the key, for spelling the names
 *   showNames   each pad's note name; an answer pad always shows its short name
 *   playable    false; when true the pads play and the answers answer
 *   velocity    what a press sends (default 100: a pad has no near end)
 *   onNoteOn(pitch, velocity, pad), onNoteOff(pitch, pad), onAnswer(index)
 *   label       its accessible name (default "Pads")
 *
 * A pressed pad shows `held` at once, and so does every twin of its pitch.
 */
import { For, Show, createMemo, createSignal, onCleanup } from 'solid-js';
import { padViews, COLS } from './pads.js';
import { written, spokenName } from './staff.js';
import { shortLabel } from '../../../src/answer_pads.mjs';
import { createPlayPointer } from './play-pointer.js';
import { gridMove } from '../kit/lib/keys.js';

let instances = 0;

export function PadGrid(props) {
  const id = `pads${++instances}`;
  const [pressed, setPressed] = createSignal(new Set());
  const [cursor, setCursor] = createSignal(null);

  const views = createMemo(() => {
    const held = pressed();
    const states = props.states instanceof Map ? props.states : new Map(Object.entries(props.states ?? {}).map(([k, v]) => [Number(k), v]));
    const merged = new Map(states);
    for (const p of held) merged.set(p, 'held');
    return padViews({ transpose: props.transpose, rootPc: props.rootPc, intervals: props.intervals,
                      states: merged, answers: props.answers });
  });

  const setHeld = (pitch, on) => setPressed((s) => {
    const next = new Set(s);
    if (on) next.add(pitch); else next.delete(pitch);
    return next;
  });

  /* A press on an answer pad answers once and plays nothing; a press on an
   * inert pad does nothing; a note pad plays its pitch. Notes are counted by
   * pitch, so two twins held together release with the last of them. */
  const target = (view) => {
    if (!view) return null;
    if (view.answer) return view.state === 'answer' ? { note: `a${view.answer.index}`, answer: view.answer.index } : null;
    if (view.inert) return null;
    return { note: view.pitch, velocity: props.velocity ?? 100, pad: view.pad };
  };
  const find = (x, y) => {
    const el = globalThis.document?.elementFromPoint(x, y)?.closest?.('[data-pad]');
    if (!el || !el.closest(`#${id}`)) return null;
    return target(views().find((v) => v.pad === Number(el.dataset.pad)));
  };
  const player = createPlayPointer({
    find,
    on: (t) => {
      if (t.answer !== undefined) return props.onAnswer?.(t.answer);
      setHeld(t.note, true);
      props.onNoteOn?.(t.note, t.velocity, t.pad);
    },
    off: (t) => {
      if (t.answer !== undefined) return;
      setHeld(t.note, false);
      props.onNoteOff?.(t.note, t.pad);
    },
  });
  onCleanup(() => player.releaseAll());

  const name = (v) => (v.answer ? shortLabel(v.answer) : written(v.pitch, props.fifths ?? 0).label);
  const spoken = (v) => (v.answer
    ? `Answer ${v.answer.index + 1}, ${v.answer.colour}: ${v.answer.label}${v.state === 'struck' ? ', struck out' : ''}`
    : `${spokenName(v.pitch, props.fifths ?? 0)}${v.state === 'off' || v.state === 'scale' ? '' : `, ${v.state}`}`);

  /* The computer keyboard: arrows move a cursor over the grid (the kit's
   * gridMove), Space or Enter presses the pad under it. */
  const onKeyDown = (e) => {
    const all = views();
    const at = cursor() ?? 0;
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      const t = target(all[at]);
      if (t) player.press(t);
      setCursor(at);
      return;
    }
    const to = gridMove(e.key, at, all.length, COLS);
    if (to === null) return;
    e.preventDefault();
    if (to !== at) player.release(target(all[at]));
    setCursor(to);
  };
  const onKeyUp = (e) => {
    if (e.key === ' ' || e.key === 'Enter') player.release(target(views()[cursor() ?? 0]));
  };

  return (
    <div id={id} class="pads" classList={{ playable: !!props.playable }}
         role={props.playable ? 'group' : 'img'} aria-label={props.label ?? 'Pads'}
         tabindex={props.playable ? 0 : undefined}
         aria-activedescendant={props.playable && cursor() !== null ? `${id}-${views()[cursor()].pad}` : undefined}
         onKeyDown={props.playable ? onKeyDown : undefined}
         onKeyUp={props.playable ? onKeyUp : undefined}
         onBlur={() => player.releaseAll()}
         {...(props.playable ? player.handlers : {})}>
      <For each={views()}>{(v, i) => (
        <div class={`pad ${v.state}`}
             classList={{ [`answer-${v.answer?.colour}`]: !!v.answer, cursor: props.playable && cursor() === i() }}
             id={`${id}-${v.pad}`} data-pad={v.pad}
             role={props.playable ? 'button' : undefined}
             aria-label={props.playable ? spoken(v) : undefined}>
          <Show when={v.answer || props.showNames}>
            <span class="pad-name t-hint">{name(v)}</span>
          </Show>
        </div>
      )}</For>
    </div>
  );
}
