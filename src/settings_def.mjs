// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * settings_def.mjs — the settings page as data. Pure.
 *
 * This replaces a 14-case numeric switch in ui.js, a parallel array of row
 * labels, and CHART_AFFECTING_SETTINGS in controls.mjs: three hand-maintained
 * copies of the same ordering, which had already had to be renumbered once and
 * would have had to again to add Wait and Grace in their natural place. Here
 * the order lives in one array, indices stop being load-bearing, and the whole
 * surface can be unit-tested without a Move.
 *
 * `rebuild: true` marks a setting that changes the notes themselves, so an
 * armed exercise has to be regenerated to match.
 */

import { MODES, MODE_LABELS, PC_NAMES } from './generator.mjs';
import { PX_PER_BEAT_MIN, PX_PER_BEAT_MAX, PX_PER_BEAT_DEFAULT } from './layout.mjs';

/*
 * How late a note may be, in beats, and still count as a hit.
 *
 * It used to also decide when the scroll stopped for you, which is why it was
 * a whole beat: at a third of one the music halted while a hand was still
 * travelling. The scroll now stops on the note whatever Grace says (Wait), so
 * Grace only judges — and a whole beat late, 750ms at 80bpm, is not in time.
 * A quarter is: about the 180ms the scoring windows allow anyway, so being in
 * time is part of the score again. Wider is there for anyone who wants it.
 *
 * 1/6 is gone. At any sensible tempo it was shorter than the 180ms late
 * window, so effectiveGrace() clamped it away and the setting did nothing.
 */
export const GRACE_VALUES = [1 / 4, 1 / 3, 1 / 2, 1, 2, 4];
export const GRACE_LABELS = ['1/4', '1/3', '1/2', '1', '2', '4'];

const onOff = (v) => (v ? 'on' : 'off');

export const SETTINGS_DEF = [
  { key: 'bpm', label: 'Tempo', type: 'int', min: 40, max: 200, rebuild: true },
  {
    key: 'pxPerBeat', label: 'Read ahead', type: 'int',
    min: PX_PER_BEAT_MIN, max: PX_PER_BEAT_MAX,
  },
  {
    /* The pitch class alone. It used to print "C# Hungarian Min" and the Scale
     * row directly below said the same thing — and at Move's longer scale
     * names the pair pushed the row's own label off the screen. */
    key: 'rootPc', label: 'Key', type: 'wrap', modulo: 12, rebuild: true,
    format: (v) => PC_NAMES[v],
  },
  { key: 'transpose', label: 'Octave', type: 'int', min: -24, max: 24, rebuild: true,
    format: (v) => (v >= 0 ? '+' : '') + v },
  {
    key: 'mode', label: 'Scale', type: 'list', values: Object.keys(MODES), rebuild: true,
    format: (v) => MODE_LABELS[v] || v,
  },
  { key: 'anyOctave', label: 'Any octave', type: 'bool', format: onOff },
  {
    /* Chromatic prompts in the note guesser. The black notes are the hard ones
     * to find on this grid, so they are in by default. Chords stay diatonic. */
    key: 'halfTones', label: 'Half tones', type: 'bool', format: onOff,
  },
  {
    /* Which chords the chord drill asks for: the diatonic triads of the key,
     * or a deliberately chosen quality — dim, aug, sus, sixths, sevenths, add9. */
    key: 'chordSet', label: 'Chords', type: 'list', values: ['triads', 'types', 'advanced'],
  },
  {
    /* Prompts per round. A fixed count makes two rounds cover the same work, so
     * the rates are comparable; 0 is open-ended practice that records nothing. */
    key: 'roundSize', label: 'Round', type: 'enum',
    values: [0, 10, 20, 30], labels: ['endless', '10', '20', '30'],
  },
  /* A chime for a right answer and an uh-oh for a wrong one, in quizzes. */
  { key: 'quizSounds', label: 'Quiz sounds', type: 'bool', format: onOff },
  /* The Info page of a practice, shown by itself the first time you open it. */
  { key: 'autoInfo', label: 'Auto info', type: 'bool', format: onOff },
  { key: 'waitForNote', label: 'Wait', type: 'bool', format: onOff },
  { key: 'graceBeats', label: 'Grace', type: 'enum', values: GRACE_VALUES, labels: GRACE_LABELS },
  { key: 'click', label: 'Click', type: 'bool', format: onOff },
  /*
   * Help that fades with the stage. At stage 1 the target notes sound as they
   * pass and the names are printed under them; at stage 2, reading alone, both
   * go quiet — hearing the line or reading its letters would be doing the
   * reading for you. Listen still plays the piece first, whatever these say.
   */
  {
    key: 'reference', label: 'Reference', type: 'enum',
    values: ['stage1', 'on', 'off'], labels: ['stage 1', 'on', 'off'],
  },
  {
    key: 'names', label: 'Names', type: 'enum',
    values: ['stage1', 'always', 'off'], labels: ['stage 1', 'always', 'off'],
  },
  { key: 'refVel', label: 'Ref vol', type: 'int', min: 0, max: 127 },
  {
    key: 'midiOut', label: 'MIDI out', type: 'enum',
    /* 4 is the module's own piano — no track, instrument or channel to get
     * right. The others send MIDI out instead. */
    values: [4, 1, 2, 3], labels: ['piano', 'track', 'USB', 'trk+USB'],
  },
  {
    /* 0 broadcasts to every channel: a Move track only hears the one its MIDI
     * input is set to, a module cannot read or change that, and a mismatch is
     * silent with no clue on screen. */
    key: 'midiCh', label: 'MIDI ch', type: 'int', min: 0, max: 16,
    format: (v) => (v === 0 ? 'all' : String(v)),
  },
  { key: 'countIn', label: 'Count in', type: 'int', min: 0, max: 8 },
];

export const SETTINGS_COUNT = SETTINGS_DEF.length;

export function settingIndex(key) {
  for (let i = 0; i < SETTINGS_DEF.length; i++) {
    if (SETTINGS_DEF[i].key === key) return i;
  }
  return -1;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/* The value as it should read on screen. */
export function formatSetting(settings, index) {
  const def = SETTINGS_DEF[index];
  if (!def) return '';
  const v = settings[def.key];
  if (def.type === 'enum') {
    const at = def.values.indexOf(v);
    return at >= 0 ? def.labels[at] : String(v);
  }
  if (def.format) return def.format(v, settings);
  return String(v);
}

/*
 * The settings as the list shows them: a folder of groups, the same as Drums
 * Practice's, each opening the page with its own rows. A group names its
 * settings by key; Path holds where the path starts (a choice kept with the
 * progress, not here), and Help two actions.
 */
export const GROUPS = [
  { key: 'path', label: 'Path', rows: [{ edit: 'start', label: 'Start at' }] },
  {
    key: 'practice', label: 'Practice',
    settings: ['bpm', 'pxPerBeat', 'rootPc', 'mode', 'anyOctave', 'waitForNote', 'graceBeats', 'countIn',
      'names', 'halfTones', 'chordSet', 'roundSize'],
  },
  { key: 'sound', label: 'Sound', settings: ['click', 'reference', 'refVel', 'quizSounds'] },
  { key: 'pads', label: 'Pads', settings: ['transpose'] },
  { key: 'midi', label: 'MIDI', settings: ['midiOut', 'midiCh'] },
  {
    key: 'help', label: 'Help', settings: ['autoInfo'],
    rows: [{ act: 'tips', label: 'Show tips again' }, { act: 'welcome', label: 'Welcome again' }],
  },
];

export function groupByKey(key) {
  return GROUPS.find((g) => g.key === key) || null;
}

/*
 * The rows of a group, or of every setting when `group` is null:
 *   { label, value, index }   a setting, by its index here
 *   { label, value, edit }    something else the jog changes ('start')
 *   { label, value: '', act } an action a click runs
 * `extra.start` is the stage the path starts at, numbered from 1.
 */
export function groupRows(group, settings, extra = {}) {
  const g = groupByKey(group);
  if (!g) return SETTINGS_DEF.map((def, i) => ({ label: def.label, value: formatSetting(settings, i), index: i }));
  const rows = (g.settings || []).map((key) => {
    const i = settingIndex(key);
    return { label: SETTINGS_DEF[i].label, value: formatSetting(settings, i), index: i };
  });
  for (const r of g.rows || []) {
    if (r.edit === 'start') rows.unshift({ label: r.label, value: 'stage ' + (extra.start || 1), edit: r.edit });
    else rows.push({ label: r.label, value: '', act: r.act });
  }
  return rows;
}

/*
 * Apply an encoder delta to one setting, in place.
 * Returns { changed, rebuild, key } so the caller knows whether an armed
 * exercise needs regenerating.
 */
export function applySetting(settings, index, delta) {
  const def = SETTINGS_DEF[index];
  if (!def || !delta) return { changed: false, rebuild: false, key: null };
  const before = settings[def.key];

  if (def.type === 'bool') {
    /* Any delta is one toggle: the host batches encoder ticks, so a flick can
     * arrive as delta 5 and must not flip the value five times. */
    settings[def.key] = !before;
  } else if (def.type === 'int') {
    settings[def.key] = clamp(before + delta, def.min, def.max);
  } else if (def.type === 'wrap') {
    settings[def.key] = (((before + delta) % def.modulo) + def.modulo) % def.modulo;
  } else if (def.type === 'list' || def.type === 'enum') {
    const at = def.values.indexOf(before);
    const step = delta > 0 ? 1 : -1;
    settings[def.key] = def.values[clamp((at < 0 ? 0 : at) + step, 0, def.values.length - 1)];
  }

  const changed = settings[def.key] !== before;
  return { changed, rebuild: Boolean(def.rebuild) && changed, key: def.key };
}

/*
 * Apply a stored settings object, taking only values this table recognises and
 * bounding them by its own declaration.
 *
 * This replaces a hand-written per-key loader in ui.js that repeated every
 * range a second time. Keeping the two in step by hand had already failed
 * once: the migrations ran in the middle of that loader, so v3's "broadcast on
 * every channel" was set and then immediately overwritten by the stored
 * channel a few lines later, and the migration silently never happened.
 * Loading is now one pass, and migrations run after it.
 */
export function coerceInto(settings, stored) {
  if (!stored || typeof stored !== 'object') return settings;
  for (let i = 0; i < SETTINGS_DEF.length; i++) {
    const def = SETTINGS_DEF[i];
    const v = stored[def.key];
    if (v === undefined || v === null) continue;

    if (def.type === 'bool') {
      if (typeof v === 'boolean') settings[def.key] = v;
    } else if (def.type === 'int') {
      if (typeof v === 'number' && isFinite(v)) settings[def.key] = clamp(Math.round(v), def.min, def.max);
    } else if (def.type === 'wrap') {
      if (typeof v === 'number' && isFinite(v)) {
        settings[def.key] = (((Math.round(v) % def.modulo) + def.modulo) % def.modulo);
      }
    } else if (def.type === 'list' || def.type === 'enum') {
      if (def.values.indexOf(v) >= 0) settings[def.key] = v;
    }
  }
  return settings;
}
