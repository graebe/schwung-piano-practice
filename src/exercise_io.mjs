/*
 * exercise_io.mjs — load and validate hand-written exercises. Pure: the caller
 * supplies the file text, so this stays testable and the host's file bindings
 * stay in ui.js.
 *
 * There is no directory-listing binding in the host, so the bundled exercises
 * are enumerated by `exercises/index.json`. Drop a file in the folder and add
 * a line to the manifest.
 */

export const MIN_PITCH = 21;
export const MAX_PITCH = 108;

export function validateExercise(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['not an object'] };
  if (typeof obj.name !== 'string' || !obj.name) errors.push('name must be a non-empty string');
  if (typeof obj.bpm !== 'number' || obj.bpm < 20 || obj.bpm > 300) errors.push('bpm must be 20..300');

  if (obj.timeSig != null) {
    const ts = obj.timeSig;
    if (!Array.isArray(ts) || ts.length !== 2) errors.push('timeSig must be [beats, unit]');
    else if (!(ts[0] >= 1 && ts[0] <= 32)) errors.push('timeSig beats must be 1..32');
    else if ([1, 2, 4, 8, 16].indexOf(ts[1]) < 0) errors.push('timeSig unit must be 1,2,4,8 or 16');
  }
  if (obj.keySig != null && !(obj.keySig >= -7 && obj.keySig <= 7)) {
    errors.push('keySig must be -7..7');
  }

  if (!Array.isArray(obj.events) || obj.events.length === 0) {
    errors.push('events must be a non-empty array');
    return { ok: errors.length === 0, errors };
  }

  let prev = -Infinity;
  for (let i = 0; i < obj.events.length; i++) {
    const e = obj.events[i];
    const at = `events[${i}]`;
    if (!e || typeof e !== 'object') {
      errors.push(`${at} is not an object`);
      continue;
    }
    if (typeof e.beat !== 'number' || !isFinite(e.beat) || e.beat < 0) {
      errors.push(`${at}.beat must be a number >= 0`);
    } else if (e.beat < prev) {
      errors.push(`${at}.beat goes backwards (${e.beat} after ${prev})`);
    } else {
      prev = e.beat;
    }
    if (e.durBeats != null && (typeof e.durBeats !== 'number' || e.durBeats <= 0)) {
      errors.push(`${at}.durBeats must be > 0`);
    }
    if (!Array.isArray(e.pitches) || e.pitches.length === 0) {
      errors.push(`${at}.pitches must be a non-empty array`);
      continue;
    }
    for (let n = 0; n < e.pitches.length; n++) {
      const p = e.pitches[n];
      if (typeof p !== 'number' || !Number.isInteger(p) || p < MIN_PITCH || p > MAX_PITCH) {
        errors.push(`${at}.pitches[${n}] must be an integer ${MIN_PITCH}..${MAX_PITCH}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/* Fill defaults and sort. Assumes validateExercise() already passed. */
export function normalizeExercise(obj, id) {
  const events = obj.events
    .map((e) => ({
      beat: e.beat,
      durBeats: e.durBeats == null ? 1 : e.durBeats,
      pitches: e.pitches.slice().sort((a, b) => a - b),
    }))
    .sort((a, b) => a.beat - b.beat);
  return {
    id: obj.id || id || 'exercise',
    name: obj.name,
    bpm: obj.bpm,
    timeSig: obj.timeSig ? obj.timeSig.slice() : [4, 4],
    keySig: obj.keySig == null ? 0 : obj.keySig,
    events,
    source: 'file',
  };
}

/* text -> { chart, errors }. Never throws: a bad file must not kill the tool. */
export function parseExercise(text, id) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return { chart: null, errors: ['invalid JSON: ' + (e && e.message ? e.message : e)] };
  }
  const { ok, errors } = validateExercise(obj);
  if (!ok) return { chart: null, errors };
  return { chart: normalizeExercise(obj, id), errors: [] };
}

/* index.json -> [{ id, name, file }]. Unparseable manifest yields []. */
export function parseManifest(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return [];
  }
  const list = Array.isArray(obj) ? obj : obj && Array.isArray(obj.exercises) ? obj.exercises : [];
  return list
    .filter((row) => row && typeof row.file === 'string')
    .map((row) => ({
      id: typeof row.id === 'string' ? row.id : row.file.replace(/\.json$/, ''),
      name: typeof row.name === 'string' ? row.name : row.file,
      file: row.file,
    }));
}

/*
 * Format-valid is not the same as playable. validateExercise only asks whether
 * a pitch is a piano note; these are the two ways a perfectly valid file can
 * still be useless on a Move:
 *
 *   - outside the staff's A3..C6, view.mjs cannot draw the note, so it scrolls
 *     past as nothing at all and is scored a miss you were never shown;
 *   - outside the pad grid's reach at the current transpose, there is no pad
 *     that can play it.
 *
 * Kept separate from validateExercise because it depends on the transpose,
 * which is a setting rather than a property of the file. The package test runs
 * it over everything bundled.
 */
export function playabilityWarnings(chart, staffRange, padRange) {
  const out = [];
  const seenOff = {};
  const seenPad = {};
  for (let i = 0; i < chart.events.length; i++) {
    const pitches = chart.events[i].pitches;
    for (let n = 0; n < pitches.length; n++) {
      const p = pitches[n];
      if ((p < staffRange.lo || p > staffRange.hi) && !seenOff[p]) {
        seenOff[p] = 1;
        out.push(`pitch ${p} is outside the staff (${staffRange.lo}..${staffRange.hi}) and cannot be drawn`);
      }
      if ((p < padRange.lo || p > padRange.hi) && !seenPad[p]) {
        seenPad[p] = 1;
        out.push(`pitch ${p} is outside pad reach (${padRange.lo}..${padRange.hi}) and cannot be played`);
      }
    }
  }
  return out;
}
