// Copied from neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/src/components/EditorFrame.jsx), MIT, Torben Gräber.
// Changed: no iPlug2 bridge. The height goes to an `onHeight` callback instead of
// a shell message, the Ground's handle to `onGround` instead of bridge.setGround,
// and with no `width` the window is fluid (no scale) for a page that reflows.
/*
 * The window every editor is drawn in.
 * Copyright (c) 2026 Torben Gräber. MIT.
 *
 * What the design system gives EVERY window, so no editor lays it out itself:
 * the ground as its first child, the content from the top ("nothing is centred
 * vertically"), the Hint bar pinned to the bottom edge with the Signature and
 * the Motion switch, the window padding, and the scale that fits a fixed design
 * width into the viewport -- with the height the editor needs reported
 * whenever the design height or the scale moves.
 *
 * Props: width, height (design px; without a width the window is fluid: it
 * fills its container and nothing is scaled), motionKey, sources (the Ground's
 * selector list), hint (clauses), status (an action's outcome as one clause, or
 * null), motionInfo and signatureInfo (the bar's own two strings),
 * onHeight(px) (the scaled height, as a string, once per distinct value),
 * onGround(handle) (the Ground's { trigger(strength), tick(), onRunning(fn) }),
 * class.
 *
 * THE INFO STRINGS ARE THE WINDOW'S, so they are wired here once: every
 * element inside it with a `data-info` puts its string in the hint bar while it
 * is pointed at or focused (lib/info.js has the rules and the precedence).
 */
import { createContext, useContext, onMount, onCleanup } from 'solid-js';
import { createFit, reportHeight } from '../lib/fit.js';
import { createMotion } from '../lib/motion.js';
import { createInfo, bindInfo, hintClauses } from '../lib/info.js';
import { Ground } from './Ground.jsx';
import { Hint } from './Hint.jsx';

/* What a component inside the window may need of it: the scale, for a canvas
 * that sizes its backing store in device pixels. */
const FrameContext = createContext(null);
export const useFrame = () => useContext(FrameContext);

export function EditorFrame(props) {
  /* Fixed or fluid is decided once: a window does not change kind under a
   * mounted ground. */
  const fixed = props.width > 0;
  const { scale } = fixed ? createFit(props.width) : { scale: () => 1 };
  const [motion, setMotion] = createMotion(props.motionKey);
  if (fixed) reportHeight(() => props.height, scale, (h) => props.onHeight?.(h));
  const info = createInfo();
  let root;
  onMount(() => onCleanup(bindInfo(root, info)));
  const bar = () => hintClauses({ conventions: props.hint ?? [], info: info.text(),
                                  status: props.status });
  const style = () => (fixed
    ? { width: `${props.width}px`, height: `${props.height}px`, transform: `scale(${scale()})` }
    : { 'min-height': props.height ? `${props.height}px` : undefined });
  return (
    <main ref={root} class={`window${fixed ? '' : ' fluid'}${props.class ? ` ${props.class}` : ''}`}
          style={style()}>
      <Ground enabled={motion()} sources={props.sources}
              ref={(h) => props.onGround?.(h)} />
      <FrameContext.Provider value={{ scale }}>{props.children}</FrameContext.Provider>
      <Hint clauses={bar().clauses} info={bar().info} motion={motion()} onMotion={setMotion}
            motionInfo={props.motionInfo} signatureInfo={props.signatureInfo} />
    </main>
  );
}
