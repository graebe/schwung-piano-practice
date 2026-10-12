// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * feedback.js — what the keyboard and the pads show, from the view model and
 * the player's hands. Pure.
 *
 * The same decisions the Move's pads make (src/led_paint.mjs), in the page's
 * vocabulary, highest first:
 *
 *   a flash      a press just judged: right ('hit') or wrong ('miss')
 *   held         a finger is on it
 *   revealed     the answer, once heard and named
 *   sounding     what Listen is playing; and a quiz's prompt where the prompt
 *                IS the question (Name), or the help ladder lit it
 *   stuck        the note the scroll is waiting on (stage 1)
 *   target       the next note, at stage 1 — 'now' when it is close
 */
import { GUESS_VIEW } from '../../../src/session.mjs';

export const FLASH_MS = 220;

/*
 * The flash a press earns, as [pitch, 'hit'|'miss'] pairs. A stray or a late
 * note is wrong on the key pressed; a right answer in a quiz lights the whole
 * answer; a quiz's wrong one, the key pressed.
 */
export function feedbackFor(out, pitch, vm) {
  if (!out) return [];
  if (out.kind === 'judged') {
    return [[pitch, out.result === 'stray' || out.result === 'late' ? 'miss' : 'hit']];
  }
  if (out.kind === 'quiz') {
    if (out.res === 'wrong') return [[pitch, 'miss']];
    if (out.res === 'correct') {
      const prompt = vm && vm.quiz && vm.quiz.prompt ? vm.quiz.prompt : [pitch];
      return prompt.map((p) => [p, 'hit']);
    }
  }
  return [];
}

function live(flash) {
  const out = new Map();
  for (const [p, f] of flash) out.set(p, f.state);
  return out;
}

/* Keyboard.jsx's states: lit, target, held, hit, miss, dim. */
export function keyStates(vm, held = new Set(), flash = new Map()) {
  const s = new Map();
  if (!vm) return s;
  const cue = vm.cue || {};
  const put = (pitches, state) => { for (const p of pitches || []) s.set(p, state); };
  put(cue.target, 'target');
  put(cue.stuck, 'lit');
  put(cue.prompt, 'lit');
  put(cue.sounding, 'lit');
  /* What the Move -- or this page's session -- is playing, on any screen. */
  put(cue.playing, 'lit');
  put(vm.revealed, 'hit');
  for (const p of held) s.set(p, 'held');
  for (const [p, state] of live(flash)) s.set(p, state);
  return s;
}

/* PadGrid.jsx's states: coming, now, held, hit, miss. */
export function padStates(vm, held = new Set(), flash = new Map()) {
  const s = new Map();
  if (!vm) return s;
  const cue = vm.cue || {};
  const put = (pitches, state) => { for (const p of pitches || []) s.set(p, state); };
  put(cue.target, cue.near ? 'now' : 'coming');
  put(cue.stuck, 'now');
  put(cue.prompt, 'now');
  put(cue.sounding, 'now');
  put(cue.playing, 'now');
  put(vm.revealed, 'hit');
  for (const p of held) s.set(p, 'held');
  for (const [p, state] of live(flash)) s.set(p, state);
  return s;
}

/*
 * The keyboard's range: two octaves from a C around what is in play, wider
 * when the piece needs it. In a quiz, round the prompt; in a piece, its whole
 * range, so the hands never have to chase the keyboard.
 */
export function keyboardRange(vm, { min = 2, max = 4 } = {}) {
  const pitches = [];
  if (vm && vm.chart) for (const e of vm.chart.events) pitches.push(...e.pitches);
  if (vm && vm.screen === GUESS_VIEW && vm.quiz && vm.quiz.prompt) pitches.push(...vm.quiz.prompt);
  if (!pitches.length) return { lowest: 48, octaves: 3 };
  const lo = Math.min(...pitches);
  const hi = Math.max(...pitches);
  const lowest = Math.max(0, Math.floor(lo / 12) * 12);
  const octaves = Math.min(max, Math.max(min, Math.ceil((hi + 1 - lowest) / 12)));
  return { lowest, octaves };
}
