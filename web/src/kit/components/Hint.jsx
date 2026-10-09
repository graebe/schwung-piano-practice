// Copied from neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/src/components/Hint.jsx), MIT, Torben Gräber.
/*
 * The hint bar. Copyright (c) 2026 Torben Gräber. MIT.
 *
 * Byte-identical in both editors before the kit existed, which is as good a
 * signal as any that it belonged here.
 */
import { For, Show } from 'solid-js';
import { Signature } from './Signature.jsx';
import { Toggle } from './Toggle.jsx';

/*
 * Three clauses at most. Truncating rather than shrinking the text is
 * deliberate: a fourth clause means the window needs simplifying, not a smaller
 * font.
 *
 * THE SIGNATURE CLOSES THE BAR, which is Ultraviolet 1.0.0's rule: it belongs
 * to the WINDOW ("exactly once, at the right end of the Hint bar"), not to any
 * one editor's layout. Carrying it here is what makes that structural -- an
 * editor cannot forget it, put it elsewhere, or show two.
 *
 * AND THE MOTION SWITCH RIDES HERE FOR EXACTLY THE SAME REASON. The design
 * system lists "use it in a window without a Motion switch" under Ground's
 * Don'ts, so the switch is a property of a window that has a ground rather than
 * of any editor's layout. An editor passes `motion` and `onMotion`; one that
 * passes neither has no ground and gets no switch. Putting it here is what makes
 * "every window with a Ground has one" true by construction instead of by
 * four editors each remembering.
 *
 * WHAT THE CLAUSES SAY IS DECIDED ABOVE THIS: EditorFrame passes the window's
 * conventions, an action's outcome or the string of the control under the
 * pointer (lib/info.js, hintClauses). The bar only draws them -- as text, so a
 * string can never be markup.
 */
export function Hint(props) {
  return (
    <div class="hint-bar t-hint">
      {/*
        * THE TIPS ARE WRAPPED SO THEY CAN GIVE WAY, and the Signature cannot.
        *
        * NI Listen-In's window is 360px wide. Three clauses and a ~110px
        * signature do not fit in the 296 that leaves, and unwrapped spans in a
        * flex row have nothing to shrink -- the row simply overflowed the
        * window. Wrapping them gives the row one shrinkable child.
        *
        * The tips truncate rather than the branding, which is the right way
        * round: the signature is fixed and the same in every window, so a
        * reader who loses its end loses nothing, while a clipped tip is at
        * least still a readable tip.
        *
        * A window that actually truncates is a window whose hints are too long
        * -- the ellipsis is the signal, not the fix.
        */}
      {/*
        * AN INFO STRING IS LAID OVER THE CLAUSES, NOT SWAPPED FOR THEM: they
        * stay, hidden, and hold the width, so the Motion switch after them
        * does not jump each time the pointer crosses a control.
        */}
      <span class="hint-tips">
        <span class="hint-clauses" classList={{ held: !!props.info }}>
          <For each={props.clauses.slice(0, 3)}>{(c, i) => (
            <>
              <Show when={i() > 0}><span class="sep">–</span></Show>
              <span class="hint-key">{c[0]}</span>
              <span class="hint-val">{c[1]}</span>
            </>
          )}</For>
        </span>
        <Show when={props.info}>{(info) => (
          <span class="hint-info">
            <span class="hint-key">{info()[0]}</span>
            <Show when={info()[1]}><span class="hint-val">{info()[1]}</span></Show>
          </span>
        )}</Show>
      </span>
      {/* Before the Signature, which keeps its margin-left: auto and so stays at
        * the right end of the bar whether or not this is here. */}
      <Show when={props.motion !== undefined}>
        <Toggle label="Motion" value={props.motion} onChange={props.onMotion}
                info={props.motionInfo} />
      </Show>
      <Signature info={props.signatureInfo} />
    </div>
  );
}
