// Copied from neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/src/lib/info.js), MIT, Torben Gräber.
/*
 * Info: what the control under the pointer or the keyboard does, in the hint bar.
 * Copyright (c) 2026 Torben Gräber. MIT.
 *
 * AN ELEMENT DECLARES ITS STRING ONCE, as `data-info` -- the kit's controls take
 * it as an `info` prop, anything else spreads `infoAttrs(text)` -- and the
 * window does the rest: one set of listeners on the window's root finds the
 * nearest `[data-info]` above whatever the pointer is over or the keyboard is
 * on, and the hint bar shows it in place of the window's conventions. The same
 * string is the element's `aria-description`, so a screen reader hears what a
 * sighted user reads.
 *
 * WHAT THE BAR SHOWS, IN ORDER OF PRECEDENCE (hintClauses):
 *
 *   1. an action's outcome ("Copied slot 1."), while the editor shows one --
 *      the user just asked for it, and it lasts seconds;
 *   2. the info under the pointer, else the info on the keyboard focus -- the
 *      pointer is the more recent intent, and when it leaves, a focused
 *      control's string is still true;
 *   3. the window's conventions.
 *
 * IN AT ONCE, OUT AFTER A BEAT. A string replaces the bar the moment the
 * pointer arrives; on leaving, the bar waits INFO_DELAY_MS before it goes back,
 * and an arrival inside that wait cancels it -- so a pointer moving along a row
 * of knobs, across the gaps between them, goes from string to string and never
 * flashes the conventions in between.
 *
 * KEYBOARD FOCUS COUNTS ONLY WHEN IT IS VISIBLE (`:focus-visible`). A click
 * focuses a knob too, and a string that stayed after the pointer had gone,
 * because of a click nobody thinks of as focusing, would be a stuck bar.
 *
 * Plain text throughout: the strings are set as text nodes and attribute
 * values, never parsed as markup.
 */
import { createSignal } from 'solid-js';

/** How long the bar holds a string after the pointer or the focus has left. */
export const INFO_DELAY_MS = 150;

/** The attributes that give an element an info string: spread them on it. */
export const infoAttrs = (text) => (text
  ? { 'data-info': text, 'aria-description': text }
  : {});

/**
 * An info string as one hint clause: [name, rest], split at the " — " the
 * strings are written with -- the name in `ink`, the rest in `ink-muted`. With
 * no dash it is all name.
 */
export function infoClause(text) {
  const at = text.indexOf(' — ');
  return at < 0 ? [text, ''] : [text.slice(0, at), text.slice(at + 1)];
}

/**
 * What the bar shows, by the precedence above: `clauses`, the window's own --
 * its conventions, with an outcome in first place while there is one -- and
 * `info`, the clause laid over them, or null. `status` is one clause or null,
 * `info` a string or null, `conventions` the window's clauses.
 *
 * THE CLAUSES ARE STILL DRAWN UNDER THE INFO, hidden: they hold the bar's
 * width, so the Motion switch after them does not move while a string comes
 * and goes (see .hint-tips in components.css).
 */
export function hintClauses({ conventions = [], info = null, status = null }) {
  if (status) return { clauses: [status, ...conventions.slice(0, 2)], info: null };
  return { clauses: conventions, info: info ? infoClause(info) : null };
}

/*
 * The state: two sources, the pointer's and the focus's, each a string and the
 * element it came from, each going back to null a beat after it is left.
 * Independent of the DOM, so its timing is tested in node; `timers` is there
 * for exactly that.
 */
export function createInfo({ delay = INFO_DELAY_MS, timers = globalThis } = {}) {
  const source = () => {
    const [text, setText] = createSignal(null);
    let el = null;
    let timer = null;
    const cancel = () => {
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    };
    return {
      text,
      el: () => el,
      show(t, from = null) {
        cancel();
        el = from;
        setText(t || null);
      },
      hide() {
        cancel();
        timer = timers.setTimeout(() => {
          timer = null;
          el = null;
          setText(null);
        }, delay);
      },
      dispose: cancel,
    };
  };
  const pointer = source();
  const focus = source();
  return {
    /** What the bar should show: the pointer's string, else the focus's. */
    text: () => pointer.text() ?? focus.text(),
    enter: pointer.show,
    leave: pointer.hide,
    focus: focus.show,
    blur: focus.hide,
    /** An element's string changed under it: show the new one, if it is the
     *  element either source is on. */
    refresh(el, text) {
      if (el === pointer.el()) pointer.show(text, el);
      if (el === focus.el()) focus.show(text, el);
    },
    dispose() { pointer.dispose(); focus.dispose(); },
  };
}

/*
 * The window's listeners, on its root: delegated, so a control added later
 * needs nothing but its attribute. Returns the function that removes them.
 */
export function bindInfo(root, info) {
  const find = (t) => {
    const el = t?.closest?.('[data-info]');
    return el && root.contains(el) ? el : null;
  };
  const point = (t) => {
    const el = find(t);
    if (el) info.enter(el.dataset.info, el);
    else info.leave();
  };
  /* WHILE A BUTTON IS HELD the pointer is dragging something -- a knob, a pad's
   * amount -- and the bar keeps saying what is being dragged, not what it
   * happens to cross. It catches up on the release. */
  const over = (e) => { if (!e.buttons) point(e.target); };
  const up = (e) => point(e.target);
  const out = (e) => { if (!e.buttons && !root.contains(e.relatedTarget)) info.leave(); };
  const focusIn = (e) => {
    const el = find(e.target);
    if (el && e.target.matches?.(':focus-visible')) info.focus(el.dataset.info, el);
    else info.blur();
  };
  const focusOut = () => info.blur();
  root.addEventListener('pointerover', over);
  root.addEventListener('pointerup', up);
  root.addEventListener('pointerout', out);
  root.addEventListener('focusin', focusIn);
  root.addEventListener('focusout', focusOut);
  /* A string that changes under the pointer -- a control whose meaning follows
   * a mode -- is shown as it is now, not as it was on arrival. */
  const watch = typeof MutationObserver === 'function'
    ? new MutationObserver((records) => {
      for (const r of records) info.refresh(r.target, r.target.dataset?.info ?? null);
    })
    : null;
  watch?.observe(root, { subtree: true, attributes: true, attributeFilter: ['data-info'] });
  return () => {
    root.removeEventListener('pointerover', over);
    root.removeEventListener('pointerup', up);
    root.removeEventListener('pointerout', out);
    root.removeEventListener('focusin', focusIn);
    root.removeEventListener('focusout', focusOut);
    watch?.disconnect();
    info.dispose();
  };
}
