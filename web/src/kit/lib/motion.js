// Copied from neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/src/lib/motion.js), MIT, Torben Gräber.
/*
 * The Motion switch's state, remembered per editor.
 * Copyright (c) 2026 Torben Gräber. MIT.
 *
 * The design system requires a Motion switch in every window that has a Ground,
 * and a switch a person has to find again every time they open the editor is not
 * really a setting. This is the one place that remembering happens, so that four
 * editors do not each write their own slightly different version of it.
 *
 * IT IS NOT A HOST PARAMETER, and that is the interesting decision rather than
 * an oversight. NI Spectrogram's header states the rule this repository follows:
 * "a number a host should own belongs in the parameter set ... A receiver's VIEW
 * is not: nobody automates which picture they are looking at." Whether the
 * background animates is a view. Making it a parameter would put it in the
 * preset, in the host's automation lanes and in every plugin's state
 * compatibility -- so that a session saved with the background off would turn it
 * off on a different machine, for a different person, who had not asked.
 *
 * SO IT IS PER-MACHINE, PER-EDITOR, AND localStorage. Which brings the caveat
 * below, and it is a real one rather than defensive boilerplate.
 *
 * A WebView on a custom URL scheme is not an ordinary web origin. Depending on
 * the host and the platform, `localStorage` may throw on access, may be
 * partitioned per plugin instance, or may not persist past the editor closing.
 * Every path here therefore has to work when storage is absent, and the default
 * when it is absent is ON -- the design's ground is part of the design, and a
 * window that silently lost it would look broken rather than configured.
 */

import { createSignal } from 'solid-js';

/* One namespace, so four editors' keys cannot collide and a reader of the
 * storage inspector can see what wrote them. */
const PREFIX = 'ultraviolet.motion.';

/** Read a remembered value. Absent, unreadable or unparseable all mean "no answer". */
function read(key) {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + key);
    if (raw === '0') return false;
    if (raw === '1') return true;
    return null;
  } catch {
    /* Storage disabled, partitioned away, or a quota error on read (which some
     * browsers really do). Not an error worth reporting to a musician. */
    return null;
  }
}

function write(key, on) {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, on ? '1' : '0');
  } catch {
    /* Nothing to do and nothing to say: the switch still works for this
     * session, it just will not be remembered. */
  }
}

/**
 * A Solid signal for one editor's Motion switch, persisted if it can be.
 *
 * @param key a short stable name for the editor, e.g. 'listen-in'
 * @returns [on, setOn] -- setOn persists as a side effect
 */
export function createMotion(key) {
  const remembered = read(key);
  const [on, setOn] = createSignal(remembered ?? true);
  return [
    on,
    (next) => {
      const value = !!next;
      setOn(value);
      write(key, value);
      return value;
    },
  ];
}
