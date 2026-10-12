// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * A piano keyboard: whole octaves from a C, each key showing a state.
 *
 * A port of the plugin kit's Keyboard (plugins/_shared/ui/src/Keyboard.cpp):
 *
 *   white key   bg-300, a 1px gap to the next; each C labelled (C3, C4 ...) in
 *               the hint style
 *   black key   bg-000 on a line-200 hairline, three fifths of the key's length
 *               and of a white key's width
 *   bass        a 3px bar under the bass key, in that key's colour
 *
 * and the states, by `states` (pitch -> state, a Map or an object):
 *
 *   lit     uv with glow-led         what sounds: the reference, a chord shown
 *   target  a uv-deep outline        what to play next: a ghost, not a light
 *   held    amber                    your finger is on it
 *   hit     uv, no glow              you played it right
 *   miss    red                      you played it wrong, or missed it
 *   dim     uv-deep                  held over, no longer sounding (the kit's
 *                                    "dimmed")
 *
 * DISPLAY ONLY BY DEFAULT, as the kit's is: it takes no pointer and no focus,
 * because a key that looks pressable invites a press that does nothing. With
 * `playable` it is an instrument: a press plays the key under it with a
 * velocity from where on the key it lands (the near end loud), a drag slides
 * from key to key, and one Tab stop takes the computer keyboard -- the arrows
 * move between keys, Space or Enter plays the one in focus. A key held by the
 * pointer shows `held` until it is let go, whatever `states` says, so the
 * press answers at once.
 *
 * Props:
 *   lowest      the C it starts on (default 48, C3)
 *   octaves     how many it shows (default 2)
 *   fit         pitches to keep in view instead of `lowest`: the keyboard
 *               stays where it is while they fit and moves to the C below the
 *               lowest when they do not (lowestToShow), `octaves` wide
 *   states      pitch -> 'lit' | 'target' | 'held' | 'hit' | 'miss' | 'dim'
 *   bass        the pitch to mark underneath, or null
 *   fifths      the key, for the names a screen reader hears (default 0)
 *   height      px, the keys and the mark under them (default 96)
 *   playable    false
 *   onNoteOn(pitch, velocity), onNoteOff(pitch)
 *   label       its accessible name (default "Keyboard")
 */
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { keyboardLayout, keyAt, velocityAt, bassMark, lowestToShow, cLabel, isBlack } from './keyboard-geometry.js';
import { spokenName } from './staff.js';
import { createPlayPointer } from './play-pointer.js';

const STATES = new Set(['lit', 'target', 'held', 'hit', 'miss', 'dim']);
const read = (states, pitch) => (states instanceof Map ? states.get(pitch) : states?.[pitch]);

let instances = 0;

export function Keyboard(props) {
  const id = `kb${++instances}`;
  let svg;
  const [width, setWidth] = createSignal(0);
  const [pressed, setPressed] = createSignal(new Set());
  const [focusKey, setFocusKey] = createSignal(null);

  const octaves = () => Math.max(1, props.octaves ?? 2);
  const height = () => props.height ?? 96;

  /* Where it starts: `fit` moves it only when the notes leave it. */
  let current = props.lowest ?? 48;
  const lowest = createMemo(() => {
    if (!props.fit) return props.lowest ?? 48;
    current = lowestToShow(props.fit, octaves(), current);
    return current;
  });

  const layout = createMemo(() => keyboardLayout({
    lowest: lowest(), octaves: octaves(), width: width(), height: height(), snap: true,
  }));

  const stateOf = (midi) => {
    if (pressed().has(midi)) return 'held';
    const s = read(props.states, midi);
    return STATES.has(s) ? s : 'rest';
  };

  /* The pointer, in the layout's px: the SVG is drawn 1:1 with its box. */
  const find = (cx, cy) => {
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const x = cx - r.left;
    const y = cy - r.top;
    const key = keyAt(layout(), x, y);
    return key ? { note: key.midi, velocity: velocityAt(key, y) } : null;
  };
  const setHeld = (midi, on) => setPressed((s) => {
    const next = new Set(s);
    if (on) next.add(midi); else next.delete(midi);
    return next;
  });
  const player = createPlayPointer({
    find,
    on: (t) => { setHeld(t.note, true); props.onNoteOn?.(t.note, t.velocity); },
    off: (t) => { setHeld(t.note, false); props.onNoteOff?.(t.note); },
  });
  onCleanup(() => player.releaseAll());

  /* The computer keyboard: one Tab stop, a cursor key, Space or Enter. */
  const keys = () => layout().keys.map((k) => k.midi).sort((a, b) => a - b);
  const onKeyDown = (e) => {
    const all = keys();
    const at = focusKey() ?? all.find((m) => !isBlack(m) && m % 12 === 0) ?? all[0];
    let to = null;
    if (e.key === 'ArrowRight') to = Math.min(all.at(-1), at + 1);
    else if (e.key === 'ArrowLeft') to = Math.max(all[0], at - 1);
    else if (e.key === 'ArrowUp') to = Math.min(all.at(-1), at + 12);
    else if (e.key === 'ArrowDown') to = Math.max(all[0], at - 12);
    else if (e.key === 'Home') to = all[0];
    else if (e.key === 'End') to = all.at(-1);
    else if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      player.press({ note: at, velocity: 100 });
      setFocusKey(at);
    } else return;
    e.preventDefault();
    if (to !== null && to !== at) {
      player.release({ note: at });
      setFocusKey(to);
    }
  };
  const onKeyUp = (e) => {
    if (e.key === ' ' || e.key === 'Enter') player.release({ note: focusKey() });
  };

  onMount(() => {
    const box = svg.parentElement;
    setWidth(box.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(box);
    onCleanup(() => ro.disconnect());
  });

  const lit = () => [...layout().keys].filter((k) => stateOf(k.midi) !== 'rest')
    .map((k) => `${spokenName(k.midi, props.fifths ?? 0)} ${stateOf(k.midi)}`);
  const summary = () => `${props.label ?? 'Keyboard'}${lit().length ? `: ${lit().join(', ')}` : ''}`;

  /* A C's label, where a white key is wide enough to hold it. */
  const label = (k) => (k.midi % 12 === 0 && k.w >= 18 ? cLabel(k.midi) : null);
  const mark = () => {
    const b = props.bass;
    if (b === null || b === undefined) return null;
    const key = layout().keys.find((k) => k.midi === b);
    return key ? { ...bassMark(key, layout().keysHeight), state: stateOf(b) } : null;
  };

  return (
    <div class="kb" classList={{ playable: !!props.playable }} style={{ height: `${height()}px` }}>
      <svg ref={svg} width={width()} height={height()} viewBox={`0 0 ${width()} ${height()}`}
           role={props.playable ? 'group' : 'img'} aria-label={summary()}
           tabindex={props.playable ? 0 : undefined}
           aria-activedescendant={props.playable && focusKey() !== null ? `${id}-${focusKey()}` : undefined}
           onKeyDown={props.playable ? onKeyDown : undefined}
           onKeyUp={props.playable ? onKeyUp : undefined}
           onBlur={() => player.releaseAll()}
           {...(props.playable ? player.handlers : {})}>
        <For each={layout().keys}>{(k) => (
          <g class="kb-key" classList={{ black: k.black, white: !k.black, [stateOf(k.midi)]: true,
                                        cursor: focusKey() === k.midi }}
             id={`${id}-${k.midi}`} role={props.playable ? 'button' : undefined}
             aria-label={props.playable ? spokenName(k.midi, props.fifths ?? 0) : undefined}
             aria-pressed={props.playable ? stateOf(k.midi) === 'held' : undefined}>
            <rect class="kb-face" x={k.x} y={k.y} width={k.w} height={k.h} />
            {/* A black key's hairline is the face showing round an inset well:
              * a stroke would straddle the pixel edge and blur at 1x. */}
            <Show when={k.black}>
              <rect class="kb-well" x={k.x + 1} y={k.y + 1} width={Math.max(0, k.w - 2)} height={Math.max(0, k.h - 2)} />
            </Show>
            <Show when={stateOf(k.midi) === 'target'}>
              <rect class="kb-ghost" x={k.x + 1} y={k.y + 1} width={Math.max(0, k.w - 2)} height={Math.max(0, k.h - 2)} />
            </Show>
            <Show when={label(k)}>
              <text class="kb-label t-hint" x={k.x + k.w / 2} y={k.h - 5} text-anchor="middle">{label(k)}</text>
            </Show>
          </g>
        )}</For>
        <Show when={mark()}>{(m) => (
          <rect class="kb-bass" classList={{ [m().state]: true }} x={m().x} y={m().y} width={m().w} height={m().h} />
        )}</Show>
      </svg>
    </div>
  );
}
