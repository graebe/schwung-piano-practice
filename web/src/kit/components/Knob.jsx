// Copied from neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/src/components/Knob.jsx), MIT, Torben Gräber.
/*
 * A knob that can be dragged finely, and its readout.
 * Copyright (c) 2026 Torben Gräber. MIT.
 *
 * Ported from UvLookAndFeel::drawRotarySlider and UvReadout::paint.
 *
 * From the Knob card, a 48px box: disc r 16, rail r 20, pointer r 6 -> 14,
 * 2px stroke. Expressed as fractions of 48 because knob-lg is the same
 * drawing at 64. The rail runs 270 degrees with the gap at the bottom.
 *
 * IT KNOWS NOTHING ABOUT PARAMETERS. It was wired straight to setParam and the
 * gesture calls; in the kit it takes `value` (normalised 0..1) and reports
 * through onInput / onBegin / onEnd, because a knob is a way of turning a
 * number and what that number MEANS is the caller's business. The same rule the
 * Select follows -- see ParamKnob in the Trance Gate's editor for the binding.
 *
 * `display` is the text under it, which the PLUGIN formats: this side holds no
 * units, no precision and no enum labels, by design, so it could not format one
 * if it wanted to.
 *
 * `detents` (normalised, optional) are values a drag holds on -- see
 * lib/detents.js for the feel and its numbers. Page Up and Page Down go to the
 * next one, and each is drawn as a tick outside the rail: an `ink-dim` mark,
 * as the system's inactive marks are, and `uv` while the value is on it.
 * Typed text, the reset and the arrows are untouched by them.
 *
 * `info` and `readoutInfo` are what the knob and its readout do, for the hint
 * bar: the knob's covers its label too, and the readout's stays while a value
 * is being typed into it.
 */
import { For, Show, createSignal } from 'solid-js';
import { EditField } from './EditField.jsx';
import { infoAttrs } from '../lib/info.js';
import { startDrag } from '../lib/drag.js';
import { dragValue, nextDetent } from '../lib/detents.js';

const BOX = 48;
const START = 135, SWEEP = 270;          /* degrees, gap at the bottom */
const TRAVEL = 200, FINE = 5;            /* px for the whole range; shift divides */

export function Knob(props) {
  let el;
  const [editing, setEditing] = createSignal(false);
  const norm = () => Math.min(1, Math.max(0, props.value ?? 0));

  /* THE PLUGIN PARSES IT, not the UI. "40 ms" needs the unit, the range and
   * the width the stage is measured against, and the UI holds none of them --
   * it would have to guess, and a guess here silently moves the patch. */
  const commitText = (text) => props.onText?.(text);

  const onPointerDown = (e) => {
    /* THE SENSITIVITY IS CHOSEN AT PRESS AND NOT RE-READ: the delta is
     * measured from the press position, so changing the divisor halfway
     * rescales everything since the press and the value jumps. */
    const fine = e.shiftKey;
    const divisor = fine ? TRAVEL * FINE : TRAVEL;
    const startY = e.clientY, startV = norm();
    /* The detents as they were at the press: a Rate changing mid-drag moves
     * them, and moving the ground under a drag would jump the value. */
    const detents = props.detents;
    /*
     * THE GESTURE OPENS ON THE FIRST MOVE, NOT ON THE PRESS. A press that
     * moves nothing -- a click, either half of a double-click -- is no edit,
     * and a gesture around no edit is an empty touch in the host's automation
     * lane and, around a double-click, two of them wrapped round the reset.
     */
    let begun = false;
    /* Tracked on the window, so the value keeps following the pointer once it
     * leaves the knob -- which is most of a real drag. */
    startDrag(
      (ev) => {
        if (!begun) {
          if (ev.clientY === startY) return;
          begun = true;
          props.onBegin?.();
        }
        props.onInput?.(dragValue(startV, startY - ev.clientY,
                                  { travel: divisor, detents, fine }));
      },
      () => { if (begun) props.onEnd?.(); });
  };

  /*
   * Double-click resets -- to the PLUGIN's default, which only the caller knows
   * (the params store has it from SHELL_MSG.defaults).
   *
   * THE `dblclick` EVENT, NOT pointerdown's `detail`. The click count on
   * pointerdown is WebKit's (WKWebView fills it in) and Chromium leaves it at
   * 0 -- so a reset read from it worked in the macOS plugin and in no Chromium
   * WebView at all. dblclick is fired by both, after the second release; the
   * presses before it moved nothing and so sent nothing (above).
   */
  const onDblClick = (e) => {
    e.preventDefault();
    props.onReset?.();
  };

  /*
   * THE KEYBOARD, because a focus ring on a control you cannot operate is
   * decoration. JUCE's Slider handled arrows itself, so the original had this
   * for free and the port quietly lost it along with the focus ring.
   *
   * Every keystroke is its own gesture: the host then records one automation
   * write per press rather than a touch that never ends.
   */
  const nudge = (delta) => {
    props.onBegin?.();
    props.onInput?.(Math.min(1, Math.max(0, norm() + delta)));
    props.onEnd?.();
  };

  const page = (dir, by) => {
    const to = nextDetent(norm(), props.detents, dir);
    nudge(to === null ? dir * by : to - norm());
  };

  const onKeyDown = (e) => {
    /* Shift is FINE here as it is in a drag, and the ratio is the same 5. */
    const step = (e.shiftKey ? 0.002 : 0.01);
    switch (e.key) {
      case 'ArrowUp': case 'ArrowRight': nudge(step); break;
      case 'ArrowDown': case 'ArrowLeft': nudge(-step); break;
      /* To the next detent where there is one, and by a tenth where not. */
      case 'PageUp': page(1, step * 10); break;
      case 'PageDown': page(-1, step * 10); break;
      case 'Home': nudge(-1); break;
      case 'End': nudge(1); break;
      /* A click on the readout types; Enter is the keyboard's way in. */
      case 'Enter': setEditing(true); break;
      default: return;                     /* not ours -- let tab through */
    }
    e.preventDefault();
  };

  const pt = (r, deg) => {
    const a = deg * Math.PI / 180;
    return [24 + r * Math.cos(a), 24 + r * Math.sin(a)];
  };
  /* BUTT CAPS, not round: a rounded cap on a 2px stroke reads as a value
   * slightly past where it is -- which on a Length knob is a different number
   * of steps. */
  const arc = (from, to) => {
    const r = BOX * (20 / 48);
    const [x0, y0] = pt(r, START + SWEEP * from);
    const [x1, y1] = pt(r, START + SWEEP * to);
    return `M ${x0} ${y0} A ${r} ${r} 0 ${SWEEP * (to - from) > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const ptr = () => {
    const [x0, y0] = pt(BOX * (6 / 48), START + SWEEP * norm());
    const [x1, y1] = pt(BOX * (14 / 48), START + SWEEP * norm());
    return `M ${x0} ${y0} L ${x1} ${y1}`;
  };

  /* A detent's tick: radial, just outside the rail (which spans r 19..21), a
   * hairline with butt caps for the same reason the arc has them. */
  const tick = (d) => {
    const [x0, y0] = pt(BOX * (22 / 48), START + SWEEP * d);
    const [x1, y1] = pt(BOX * (24 / 48), START + SWEEP * d);
    return `M ${x0} ${y0} L ${x1} ${y1}`;
  };
  const onDetent = (d) => Math.abs(d - norm()) < 1e-4;

  /*
   * NUMBER IN ink, UNIT IN ink-muted -- split at the LAST space.
   *
   * "40.0 ms" and "90 %" split cleanly; "1/16" and "1.00" have no space and
   * are all number, which is what the system wants for a unitless value.
   * Splitting at the last space rather than the first keeps "1 / 16 T" whole
   * on the number side rather than calling "16 T" a unit.
   */
  const split = () => {
    const t = props.display ?? '';
    const cut = t.lastIndexOf(' ');
    return cut > 0 ? [t.slice(0, cut), t.slice(cut + 1)] : [t, ''];
  };

  return (
    <div class="knob-card" data-info={props.info}>
      <div class="knob-label t-label">{props.label}</div>
      <svg ref={el} class="knob" width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`}
           tabindex="0" role="slider" aria-label={props.label}
           aria-valuetext={props.display ?? ''} aria-description={props.info}
           aria-valuenow={norm()} aria-valuemin="0" aria-valuemax="1"
           onPointerDown={onPointerDown} onDblClick={onDblClick} onKeyDown={onKeyDown}>
        {/* the well */}
        <circle cx="24" cy="24" r={BOX * (16 / 48)} fill="var(--bg-200)" />
        {/* the rail */}
        <path d={arc(0, 1)} fill="none" stroke="var(--line-200)" stroke-width="2" stroke-linecap="butt" />
        {/* the detents: marks, so no glow */}
        <For each={props.detents ?? []}>{(d) => (
          <path class="knob-tick" classList={{ on: onDetent(d) }} d={tick(d)}
                stroke={onDetent(d) ? 'var(--uv)' : 'var(--ink-dim)'}
                stroke-width="1" fill="none" stroke-linecap="butt" />
        )}</For>
        {/*
          * THE ARC'S DROP SHADOW, WHICH IS WHERE ITS COLOUR COMES FROM. The
          * value arc is near-white; drawn alone it is a white line on a dark
          * disc and the knob has no cast at all. uv-deep underneath it, wider
          * and soft, is what makes it read as violet.
          */}
        {norm() > 0.0001 && (
          /* --glow-arc, not a hand-typed rgba: this had drifted to alpha 0.75
           * against the system's 0.45, and a literal here is exactly what the
           * token guard now fails on. */
          <g class="glow-arc">
            <path d={arc(0, norm())} fill="none" stroke="var(--uv)" stroke-width="2" stroke-linecap="butt" />
          </g>
        )}
        {/* the pointer, inside the disc */}
        <path d={ptr()} stroke="var(--uv)" stroke-width="2" fill="none" stroke-linecap="butt" />
      </svg>

      {/* CLICK THE READOUT TO TYPE -- one click, as the design's interaction
        * conventions say ("click the readout to type"). */}
      <Show when={editing()} fallback={
        <div class="readout t-value" role="button" tabindex="-1"
             aria-label={`${props.label ?? ''} value`} {...infoAttrs(props.readoutInfo)}
             onClick={() => setEditing(true)}>
          <span class="num">{split()[0]}</span>
          <Show when={split()[1]}><span class="unit">{split()[1]}</span></Show>
        </div>
      }>
        <EditField class="readout editing t-value" value={props.display ?? ''}
                   ariaLabel={props.label} info={props.readoutInfo}
                   onCommit={commitText} onClose={() => setEditing(false)} />
      </Show>
    </div>
  );
}
