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

import { MODES, PC_NAMES } from './generator.mjs';
import { PX_PER_BEAT_MIN, PX_PER_BEAT_MAX, PX_PER_BEAT_DEFAULT } from './layout.mjs';

/* Tolerance before the scroll freezes, as a fraction of a beat. Tempo-relative
 * because "the rhythm doesn't break" is a musical span, not a fixed duration. */
export const GRACE_VALUES = [1 / 6, 1 / 4, 1 / 3, 1 / 2, 1];
export const GRACE_LABELS = ['1/6', '1/4', '1/3', '1/2', '1'];

const onOff = (v) => (v ? 'on' : 'off');

export const SETTINGS_DEF = [
  { key: 'bpm', label: 'Tempo', type: 'int', min: 40, max: 200, rebuild: true },
  {
    key: 'pxPerBeat', label: 'Read ahead', type: 'int',
    min: PX_PER_BEAT_MIN, max: PX_PER_BEAT_MAX,
  },
  {
    key: 'rootPc', label: 'Key', type: 'wrap', modulo: 12, rebuild: true,
    format: (v, s) => PC_NAMES[v] + ' ' + s.mode,
  },
  { key: 'transpose', label: 'Octave', type: 'int', min: -24, max: 24, rebuild: true,
    format: (v) => (v >= 0 ? '+' : '') + v },
  { key: 'mode', label: 'Scale', type: 'list', values: Object.keys(MODES), rebuild: true },
  { key: 'guidance', label: 'Guide pads', type: 'bool', format: onOff },
  { key: 'anyOctave', label: 'Any octave', type: 'bool', format: onOff },
  { key: 'waitForNote', label: 'Wait', type: 'bool', format: onOff },
  { key: 'graceBeats', label: 'Grace', type: 'enum', values: GRACE_VALUES, labels: GRACE_LABELS },
  { key: 'click', label: 'Click', type: 'bool', format: onOff },
  { key: 'reference', label: 'Reference', type: 'bool', format: onOff },
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

/* Every row, ready for view.drawList. */
export function settingsRows(settings) {
  return SETTINGS_DEF.map((def, i) => ({
    label: def.label,
    value: formatSetting(settings, i),
  }));
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
