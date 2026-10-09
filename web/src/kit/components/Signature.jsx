// Copied from neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/src/components/Signature.jsx), MIT, Torben Gräber.
/*
 * The publisher's signature. Copyright (c) 2026 Torben Gräber. MIT.
 *
 * Ultraviolet 1.0.0 added this, and its card is exact: "a 6px square lit in
 * `uv` with `glow-led`, then NEON INGVY in 10px mono, weight 500, tracked
 * 0.2em, uppercase, `ink-muted`, 8px apart. Every plugin window carries it
 * exactly once, at the right end of the `Hint` bar, level with the hint text."
 *
 * WHICH IS WHY IT LIVES INSIDE Hint RATHER THAN BEING PLACED BY EACH EDITOR.
 * "Exactly once, at the right end of the Hint bar" is a rule about the WINDOW,
 * not about one plugin's layout, and every window here already ends in a Hint
 * bar. Putting it in the bar makes the rule structural: an editor cannot forget
 * it, cannot put it somewhere else, and cannot show two.
 *
 * THE NAME IS FIXED AND TAKES NO PROP. The card says "Consumer provides:
 * nothing", and a `name` prop would be an invitation to put something else
 * there -- which the same card forbids in as many words ("do not ... pair it
 * with another logo").
 *
 * `info` is what the hint bar says while the pointer is on it -- a description,
 * not a name, and the editor's to write like every other string there.
 */

import { infoAttrs } from '../lib/info.js';

/** The signature, as it appears in a plugin window. */
export function Signature(props) {
  return (
    <span class="signature" aria-label="Neon Ingvy" {...infoAttrs(props.info)}>
      <i class="mark" aria-hidden="true" />
      Neon Ingvy
    </span>
  );
}
