/*
 * controls.mjs — what the transport lights should show, and where the jog
 * should take you. Pure: no host calls, no module state.
 *
 * This exists because of a bug that shipped. ui.js had
 *
 *     setButtonLED(CC_PLAY, view === RUNNING ? 127 : 0);
 *
 * which lit the Play button only while already running, and switched it off in
 * READY — dark at exactly the moment its job was to say "press me". Nothing
 * caught it: ui.js talks to host globals that do not exist off-device, so it
 * can only be regex-checked, and no regex was going to notice that the false
 * branch was the wrong colour. Decisions live here now, where a test can run
 * them.
 */

/* Views, mirrored from ui.js. */
export const MENU = 'menu';
export const READY = 'ready';
export const RUNNING = 'running';
export const SUMMARY = 'summary';
export const SETTINGS = 'settings';

/* Palette indices (src/shared/constants.mjs). */
export const OFF = 0;
export const GREEN = 126;      /* PureGreen  #00FF00 */
export const GREEN_DIM = 85;   /* NeonGreen dim #144D08 */
export const RED = 127;
export const RED_DIM = 65;     /* BrightRed dim #661914 */

export const PULSE_MS = 500;

/* Pulse phase from a monotonic clock: alternates 0/1 twice a second. */
export function pulsePhase(nowMs, periodMs = PULSE_MS) {
  return Math.floor(nowMs / periodMs) % 2;
}

/*
 * Play is the LISTEN button: the exercise plays itself and nothing is scored.
 * Record is the PRACTICE button: you perform it and it scores you. That way
 * round because at an instrument "play" means play it to me, and "record"
 * means capture what I do.
 *
 * In READY both pulse, in their own colours, so the two choices read as equals
 * — the screen labels them, and the lights say both are live. While a run is
 * going the active mode is solid and the other dims, so the buttons always say
 * what is happening.
 *
 * Whatever else changes here, READY must never be OFF for either: that was the
 * shipped bug this module exists to prevent, and both tests below guard it.
 */
export function playLedColor(view, phase, listening = false) {
  if (view === RUNNING) return listening ? GREEN : GREEN_DIM;
  if (view === READY || view === SUMMARY) return phase ? GREEN : GREEN_DIM;
  return OFF;
}

export function recordLedColor(view, listening = false, phase = 1) {
  if (view === RUNNING) return listening ? RED_DIM : RED;
  if (view === READY || view === SUMMARY) return phase ? RED : RED_DIM;
  return OFF;
}

/*
 * Where a jog turn goes.
 *
 *   ignore  nothing happens — a nudge mid-exercise must not abandon the run
 *   cursor  move the highlight in a list
 *   select  step to the neighbouring exercise and arm it, staying put
 *
 * Both list moves clamp rather than wrap: on a short list, wrapping from the
 * last entry back to the first feels like a misfire.
 */
export function jogAction(view, delta, index, count) {
  if (view === RUNNING) return { action: 'ignore', index };
  if (count <= 0) return { action: 'ignore', index };
  const next = Math.max(0, Math.min(count - 1, index + (delta > 0 ? 1 : -1)));
  if (view === MENU || view === SETTINGS) return { action: 'cursor', index: next };
  if (next === index) return { action: 'ignore', index };
  return { action: 'select', index: next };
}

/*
 * May the exercise on screen be rebuilt right now?
 *
 * WHICH settings change the notes is a property of the setting, and lives on
 * the table in settings_def.mjs as `rebuild` — it used to be a hard-coded index
 * list here, a third copy of the settings ordering that had to be renumbered by
 * hand every time a row moved. This answers only the other half: whether
 * anything is armed to rebuild, and whether it is ours to regenerate. A
 * hand-written file is fixed notes, not a recipe to re-run in another key.
 */
export function shouldRebuildChart(view, chartSource) {
  if (view !== READY && view !== SUMMARY && view !== SETTINGS) return false;
  return chartSource !== 'file';
}

/*
 * Where a jog click goes. The settings page has nine rows but only four knobs,
 * so the rest are reachable the way Move does it everywhere else: click to
 * enter edit, turn to change, click to leave.
 */
export function jogClickAction(view, shiftHeld, hasChart) {
  if (shiftHeld) return view === SETTINGS ? (hasChart ? 'ready' : 'menu') : 'settings';
  if (view === SETTINGS) return 'toggle-edit';
  if (view === MENU) return 'open';
  return 'menu';
}

/* Whole beats still to go in the count-in, or 0 once the piece has started. */
export function countInRemaining(songBeats) {
  if (songBeats >= 0) return 0;
  return Math.ceil(-songBeats);
}

/*
 * How loudly the exercise itself should sound as it crosses the hit line.
 * 0 means silent.
 *
 *   Listen mode  — full velocity; the reference IS the point
 *   Reference on — softer than your pads, so when you are in time you hear one
 *                  note and when you are not you hear a flam
 *   Reference off — silent, unaided reading
 */
export function referenceVelocity(listening, referenceOn, refVel, listenVel = 90) {
  if (listening) return listenVel;
  if (!referenceOn) return 0;
  return refVel;
}

/* Nothing sounds before the first beat — the count-in has no notes to play. */
export function referenceAudible(songBeats, listening, referenceOn) {
  if (songBeats < 0) return false;
  return listening || referenceOn;
}
