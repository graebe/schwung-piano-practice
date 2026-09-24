/*
 * ui_contract.test.mjs — source-level assertions on the one file that cannot
 * be executed off-device. ui.js talks to host globals that only exist inside
 * Schwung, so these pin the handful of rules that, if broken, produce a module
 * that loads and then behaves badly on hardware: a draw that outruns the
 * panel, an IPC call in the frame path, notes left ringing after exit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../src/module.json', import.meta.url), 'utf8'));

/* Comments explain which host calls are forbidden and why, so "must not appear"
 * checks run against the code with comments stripped. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('all six lifecycle hooks are installed on globalThis', () => {
  for (const hook of ['init', 'tick', 'onMidiMessageInternal', 'onMidiMessageExternal', 'onResume', 'onUnload']) {
    assert.match(source, new RegExp(`globalThis\\.${hook} = function`), hook);
  }
});

test('the draw is throttled off the monotonic clock, not Date.now()', () => {
  assert.match(source, /performance\.now\(\)/);
  assert.match(source, /DRAW_INTERVAL_MS\s*=\s*\d+/);
  assert.match(source, /t - lastDrawMs >= DRAW_INTERVAL_MS/);
  const interval = Number(source.match(/DRAW_INTERVAL_MS\s*=\s*(\d+)/)[1]);
  assert.ok(interval >= 18, `${interval}ms outruns the ~49Hz panel`);
  assert.doesNotMatch(code, /=\s*Date\.now\(\)\s*;/, 'wall-clock time can jump mid-run');
});

test('no per-frame IPC: a param read costs more than a whole frame', () => {
  assert.doesNotMatch(code, /host_module_get_param/);
  assert.doesNotMatch(code, /shadow_get_param/);
  assert.doesNotMatch(code, /host_module_set_param_blocking/);
});

test('a parked module stops drawing', () => {
  assert.match(source, /globalThis\.overtakeParked/);
  const tickBody = source.match(/globalThis\.tick = function tick\(\) \{([\s\S]*?)\n\};/)[1];
  assert.match(tickBody, /^\s*if \(globalThis\.overtakeParked\) return;/m);
});

test('every optional host binding is typeof-guarded', () => {
  const optional = [
    'host_read_file', 'host_write_file', 'host_exit_module',
    'move_midi_inject_to_move', 'move_midi_external_send', 'text_width',
  ];
  for (const fn of optional) {
    assert.match(source, new RegExp(`typeof ${fn} (!==|===) 'function'`), `${fn} is unguarded`);
  }
});

test('MIDI goes out on cable 2, the path Move tracks listen on', () => {
  assert.match(source, /\(2 << 4\) \| cin/);
  assert.match(source, /move_midi_inject_to_move\(/);
});

test('nothing is left ringing on the way out', () => {
  const unload = source.match(/globalThis\.onUnload = function onUnload\(\) \{([\s\S]*?)\n\};/)[1];
  assert.match(unload, /allNotesOff\(\)/);
  assert.match(code, /function exitModule\(\)[\s\S]{0,400}allNotesOff\(\)/);
});

test('a panic is indiscriminate: every channel, both routes, sound and notes', () => {
  /* Being selective here is how a note ends up sounding in someone DAW after
   * the module has closed. */
  const panic = code.match(/function panicChannel\(ch\) \{([\s\S]*?)\n\}/)[1];
  assert.match(panic, /sendTrack, sendUsb/, 'both routes regardless of the setting');
  assert.match(panic, /120, 0/, 'All Sound Off');
  assert.match(panic, /123, 0/, 'All Notes Off');
  assert.match(panic, /64, 0/, 'sustain released');
  /* and the exit sweeps all sixteen channels, not just the one in use */
  assert.match(code, /panicChannelNext = 0;/);
  assert.match(code, /panicChannelNext < 16/);
});

test('the channel sweep is paced so it cannot overrun the inject ring', () => {
  /* The ring holds 64 packets and drains 31 per audio block; 16 channels of
   * three CCs down two routes is 96. */
  assert.match(code, /PANIC_CH_PER_TICK = \d+/);
  const perTick = Number(code.match(/PANIC_CH_PER_TICK = (\d+)/)[1]);
  assert.ok(perTick * 6 <= 31, `${perTick} channels a tick is ${perTick * 6} packets`);
});

test('note on/off is refcounted, so isomorphic twins cannot cut each other off', () => {
  assert.match(source, /pitchRefcount/);
  assert.match(source, /function noteOff[\s\S]{0,300}prev <= 1/);
});

test('input follows the host conventions', () => {
  /* Knob touch is no longer discarded — it points at the row that knob edits —
   * but it must still never reach the pad handler. */
  assert.match(source, /if \(d1 < 10\) \{[\s\S]{0,200}return;\n?\s*\}/,
    'knob capacitive touch must not fall through to the pads');
  assert.match(source, /onKnobTouch/, 'and it is used, not dropped');
  assert.match(source, /decodeDelta\(d2\)/, 'encoders arrive batched and must be decoded');
  assert.match(source, /CC_JOG_TURN = 14/);
  assert.match(source, /CC_PLAY = 85/);
  assert.match(source, /CC_BACK = 51/);
});

test('Back exits through the host, since this module does not suspend', () => {
  assert.equal(manifest.capabilities.suspend_keeps_js, undefined);
  assert.match(source, /host_exit_module\(\)/);
});

test('shared libraries come from the installed absolute path', () => {
  assert.match(source, /from '\/data\/UserData\/schwung\/shared\/input_filter\.mjs'/);
  assert.match(source, /from '\/data\/UserData\/schwung\/shared\/screen_reader\.mjs'/);
});

test('the module ships its own logic as siblings, not copies', () => {
  for (const mod of ['layout', 'padmap', 'generator', 'scoring', 'view', 'chart', 'exercise_io', 'controls', 'settings_def', 'guess']) {
    assert.match(source, new RegExp(`from '\\./${mod}\\.mjs'`), mod);
  }
  assert.doesNotMatch(code, /function pitchToY/, 'notation belongs in notation.mjs');
  assert.doesNotMatch(code, /function judgeNoteOn/, 'scoring belongs in scoring.mjs');
});

test('LED writes go through the shared cache — the queue only flushes 16 a tick', () => {
  assert.match(source, /import \{[\s\S]{0,200}setLED[\s\S]{0,200}\} from '\/data\/UserData\/schwung\/shared\/input_filter\.mjs'/);
  assert.doesNotMatch(code, /move_midi_internal_send/, 'use setLED, not raw packets');
  assert.match(source, /invalidateLedCache\(\)/);
});

test('the manifest matches what the code assumes', () => {
  assert.equal(manifest.id, 'piano-practice');
  assert.equal(manifest.component_type, 'tool');
  assert.equal(manifest.api_version, 2);
  assert.equal(manifest.ui, 'ui.js');
  assert.equal(manifest.tool_config.overtake, true, 'pads and LEDs need overtake');
  assert.equal(manifest.tool_config.interactive, true);
  assert.equal(manifest.tool_config.skip_file_browser, true);
  assert.equal(manifest.capabilities.midi_out, true);
  assert.equal(manifest.capabilities.note_passthrough, undefined, 'inert in this host');
  assert.match(source, new RegExp(`modules/tools/${manifest.id}`));
});

test('guidance is off by default — this is a sight-reading trainer', () => {
  assert.match(source, /guidance: false/);
  assert.match(source, /anyOctave: false/);
});

test('settings are persisted next to the module and survive a bad file', () => {
  assert.match(source, /SETTINGS_PATH = MODULE_DIR \+ '\/settings\.json'/);
  assert.match(source, /function loadSettings\(\)[\s\S]{0,400}try \{[\s\S]{0,120}JSON\.parse/);
  assert.match(source, /function saveSettings\(\)/);
  /* Load in one pass from the table, THEN migrate. Interleaving the two is how
   * v3 came to be overwritten by the value it was meant to replace. */
  assert.match(code, /SET\.coerceInto\(settings, obj\)/);
  const load = code.match(/function loadSettings\(\) \{([\s\S]*?)\n\}/)[1];
  assert.ok(load.indexOf('coerceInto') < load.indexOf('storedVersion'),
    'every stored value must be read before any migration runs');
  assert.doesNotMatch(load, /clamp\(obj\./, 'no second copy of the ranges');
  /* And only write when something actually changed. */
  assert.match(load, /if \(migrated\) saveSettings\(\)/);
  /* Encoder steps arrive up to once per 500Hz tick, so the write must not be
   * inline: a knob spin would put blocking eMMC I/O in the frame path. */
  assert.match(code, /function saveSettings\(\)\s*\{\s*settingsDirty = true;\s*\}/);
  assert.match(code, /function flushSettings\(force\)[\s\S]{0,300}SAVE_INTERVAL_MS/);
  assert.match(code, /flushSettings\(true\)/, 'always flush on unload');
  const unloadBody = code.match(/globalThis\.onUnload = function onUnload\(\) \{([\s\S]*?)\n\};/)[1];
  assert.match(unloadBody, /flushSettings\(true\)/);
});

/*
 * The Play-button bug lived here, in the one file a test cannot execute. The
 * decisions now live in controls.mjs, where controls.test.mjs runs them for
 * real; these two guard against them creeping back inline.
 */
test('transport LEDs are decided in controls.mjs, not inline', () => {
  assert.match(code, /setButtonLED\(CC_PLAY, CTRL\.playLedColor\(/);
  assert.match(code, /setButtonLED\(CC_RECORD, CTRL\.recordLedColor\(/);
  assert.doesNotMatch(code, /setButtonLED\(CC_PLAY,\s*(view|listening)/, 'no inline ternary');
  assert.doesNotMatch(code, /setButtonLED\([^)]*\?\s*\d+\s*:\s*0\)/, 'the exact shape of the shipped bug');
});

test('the jog cannot drop out of a run', () => {
  const jog = code.match(/function onJog\(delta\) \{([\s\S]*?)\n\}/)[1];
  assert.match(jog, /CTRL\.jogAction\(/);
  assert.doesNotMatch(jog, /view = MENU/, 'a nudge must not abandon the exercise');
  const click = code.match(/function onJogClick\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(click, /CTRL\.jogClickAction\(/);
});

test('the count-in resets, so a second run still clicks', () => {
  const arm = code.match(/function armRun\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(arm, /lastClickBeat = null/);
  assert.match(arm, /songBeats = -settings\.countIn/);
});

test('the LED pulse is repainted on phase change, not every tick', () => {
  assert.match(code, /CTRL\.pulsePhase\(t\)/);
  assert.match(code, /phase !== ledPhase[\s\S]{0,120}ledDirty = true/);
});

test('every settings row is reachable, not just the four on knobs', () => {
  assert.match(code, /settingsEditing/);
  assert.match(code, /if \(settingsEditing\) editSetting\(settingsCursor, delta\)/);
});

test('the reference line is decided in controls.mjs, and skips the count-in', () => {
  assert.match(code, /CTRL\.referenceVelocity\(listening, settings\.reference, settings\.refVel\)/);
  const ref = code.match(/function serviceReference\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(ref, /songBeats < 0/, 'the count-in has no notes to sound');
  /* The cursor must advance even when silent, or enabling it mid-run dumps
   * every skipped note at once. */
  assert.match(ref, /listenIndex\+\+[\s\S]{0,240}if \(silent\) continue;/);
  assert.match(code, /reference: true/, 'on by default');
});

test("Move's Menu button opens the exercise list", () => {
  assert.match(code, /const CC_MENU = 50;/);
  assert.match(code, /d1 === CC_MENU[\s\S]{0,120}view = MENU/);
});

test('the scroll freezes on the note and the judge keeps real time', () => {
  /*
   * The order is now freeze-then-resolve, the reverse of what it was. Expiring
   * used to have to come first because a frozen clock could never reach the
   * note's late window; scoreBeats reaches it frozen or not, so the freeze is
   * decided from the run and the judgement follows on real time.
   */
  const tickBody = code.match(/globalThis\.tick = function tick\(\) \{([\s\S]*?)\n\};/)[1];
  const expireAt = tickBody.indexOf('SCORE.expireMissed');
  const blockAt = tickBody.indexOf('SCORE.blockingBeat');
  assert.ok(expireAt >= 0 && blockAt >= 0);
  assert.ok(blockAt < expireAt, 'the freeze is decided before the judgement');
  assert.match(tickBody, /applyWait\(raw, waitedBeats, block, frozenAt\)/);
  /* Scored on the honest clock, drawn on the frozen one. Getting these the
   * wrong way round makes every press during a freeze a perfect hit. */
  assert.match(tickBody, /expireMissed\(run, scoreBeats/);
  assert.match(tickBody, /runFinished\(run, songBeats, blocked\)/);
});

test('switching wait on mid-run resyncs instead of dragging time backwards', () => {
  assert.match(code, /res\.key === 'waitForNote'[\s\S]{0,200}SCORE\.resyncWait\(run, songBeats\)/);
});

test('every press is marked, at the moment it happened', () => {
  const down = code.match(/function onPadDown\(pad, vel\) \{([\s\S]*?)\n\}/)[1];
  /*
   * songBeats for the MARKER, scoreBeats for the JUDGEMENT, and the split is
   * the point. A marker is a statement about the picture — a ring clear of its
   * notehead is the timing error made visible — so it goes where the press was
   * seen. On the honest clock it landed RIGHT of the hit line during a freeze,
   * drawing a ring over notes not yet reached, and a ring is the same glyph as
   * a hit notehead.
   */
  assert.match(down, /SCORE\.addMarker\(run, pitch, songBeats\)/);
  assert.match(down, /judgeNoteOn\(run, pitch, scoreBeats\)/);
  /* Before the judgement, so a stray is marked too. */
  assert.ok(down.indexOf('addMarker') < down.indexOf('judgeNoteOn'));
  assert.match(code, /SCORE\.pruneMarkers\(/, 'markers must not accumulate forever');
});

test('the settings page is a table, not a renumbering hazard', () => {
  assert.match(code, /SET\.applySetting\(settings, index, delta\)/);
  assert.match(code, /SET\.settingsRows\(settings\)/);
  assert.doesNotMatch(code, /case 7:/, 'the numeric switch is gone');
  assert.doesNotMatch(code, /CHART_AFFECTING_SETTINGS/);
});

/*
 * The declared settings version.
 *
 * A migration test asks whether ITS migration is still there, never what the
 * current version happens to be — two tests pinned `SETTINGS_VERSION = 4`
 * while testing the v2 and v3 migrations, so raising it to 5 broke both of
 * them for no reason connected to what they check.
 */
function settingsVersion() {
  const m = code.match(/SETTINGS_VERSION = (\d+)/);
  assert.ok(m, 'ui.js must declare a settings version');
  return Number(m[1]);
}

test('wait is on by default, and the grace is long enough to find the key', () => {
  assert.match(code, /waitForNote: true/);
  /* A third of a beat is 250ms at 80bpm, and the scroll halted while the hand
   * was still travelling. Sight-reading is mostly spent finding the pad. */
  assert.match(code, /graceBeats: 1,/);
  /* And the change has to reach someone who has already used the module: a
   * saved settings.json always beats a changed default. */
  assert.match(code, /storedVersion < 5[\s\S]{0,160}settings\.graceBeats = 1/);
});

/* ---- Closing cleanly ----------------------------------------------------- */

test('the metronome click is refcounted like any other note', () => {
  /* allNotesOff can only silence what pitchRefcount knows about. A click sent
   * with a raw midiOut was left sounding when the module closed between its
   * note-on and its scheduled note-off. */
  const click = code.match(/function serviceClick\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(click, /noteOn\(pitch,/);
  assert.doesNotMatch(click, /midiOut\(0x90/, 'the click must not bypass the refcount');
});

test('silencing also drops anything still scheduled', () => {
  const off = code.match(/function allNotesOff\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(off, /listenOff\.length = 0/);
  assert.match(off, /panicChannel\(midiChannel\)/);
  /* Note-offs go down both routes: the destination may have changed since the
   * note-on, and only the path that started a note can release it. */
  assert.match(off, /sendTrack\(0x80/);
  assert.match(off, /sendUsb\(0x80/);
});

test('the MIDI destination is a setting, not an assumption', () => {
  assert.match(code, /OUT_TRACK = 1/);
  assert.match(code, /OUT_USB = 2/);
  /* The route rides on each queued packet and is applied when the outbox drains. */
  assert.match(code, /route & OUT_TRACK[\s\S]{0,60}sendTrack/);
  assert.match(code, /route & OUT_USB[\s\S]{0,60}sendUsb/);
  assert.match(code, /queue\(settings\.midiOut,/);
  assert.match(code, /midiOut: OUT_INTERNAL/, 'the module makes its own sound by default');
  assert.match(code, /move_midi_external_send/);
});

test('the exit waits for the MIDI ring before tearing overtake down', () => {
  /* move_midi_inject_to_move is held back a few SPI frames, and three more
   * after overtake ends: exiting on the same tick that queues the note-offs
   * races the teardown and drops them. */
  const exit = code.match(/function exitModule\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(exit, /allNotesOff\(\)/);
  assert.doesNotMatch(exit, /host_exit_module/, 'must not exit on the same tick');
  assert.match(exit, /pendingExitAt = now\(\) \+ EXIT_DRAIN_MS/);
  assert.match(code, /function serviceExit\(\)[\s\S]{0,400}host_exit_module\(\)/);
  assert.match(code, /EXIT_DRAIN_MS = \d+/);
});

test('nothing else runs while closing', () => {
  const tickBody = code.match(/globalThis\.tick = function tick\(\) \{([\s\S]*?)\n\};/)[1];
  assert.match(tickBody, /if \(pendingExitAt\) \{[\s\S]{0,80}serviceExit\(\);[\s\S]{0,40}return;/);
  /* and that guard comes before any note or clock work */
  assert.ok(tickBody.indexOf('pendingExitAt') < tickBody.indexOf('serviceReference'));
});

test('Shift+Back closes from anywhere, not three presses deep', () => {
  const back = code.match(/if \(d1 === CC_BACK\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(back, /if \(shiftHeld\) \{[\s\S]{0,60}exitModule\(\)/);
  assert.ok(back.indexOf('shiftHeld') < back.indexOf('view === SETTINGS'), 'checked first');
});

test('changing MIDI channel silences the channel being left behind', () => {
  assert.match(code, /res\.key === 'midiCh'[\s\S]{0,260}allNotesOff\(\)[\s\S]{0,120}midiChannel = /);
});

test('Play listens, Record practises, and each PAUSES its own mode', () => {
  /*
   * Pressing the button again holds the playhead where it is rather than
   * throwing the position away, so you can scrub and carry on from where you
   * land. Back is what restarts; these two only ever toggle.
   */
  const play = code.match(/if \(d1 === CC_PLAY\) \{([\s\S]*?)\n  \}/)[1];
  const rec = code.match(/if \(d1 === CC_RECORD\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(play, /startRun\(true\)/, 'Play must listen');
  assert.match(play, /view === RUNNING && listening[\s\S]{0,40}togglePause/);
  assert.match(rec, /startRun\(false\)/, 'Record must practise');
  assert.match(rec, /view === RUNNING && !listening[\s\S]{0,40}togglePause/);
  assert.ok(!play.includes('stopRun'), 'Play must not reset the position');
  assert.ok(!rec.includes('stopRun'), 'Record must not reset the position');
});

test('the scrub is paused-only and costs no MIDI when nothing sounds', () => {
  /*
   * Seeking under your own feet mid-playback is not wanted, and on the READY
   * screen it was worse than useless: Play calls armRun, which resets to zero,
   * so the scrub was silently discarded.
   *
   * And seekTo runs several times a frame while the knob turns. allNotesOff is
   * seven host writes against an inject ring of sixty-four, so it has to be
   * conditional — unguarded, a single scrub measured 420 writes.
   */
  assert.match(code, /view === RUNNING && paused\) scrubBy/);
  assert.match(code, /if \(sounding\) allNotesOff\(\)/);
});

test('the clock stands still while paused', () => {
  /* Everything else about the frame keeps running — the LEDs, the drawing —
   * but nothing derived from songBeats may move, or a pause would drift. */
  /* The CLOCK stops, the frame does not: the draw gate requires `dirty`, which
   * is set at the bottom of the running block, so gating the whole block would
   * stop the panel repainting and a scrub while paused would show nothing. */
  assert.match(code, /if \(!paused\) \{/);
  assert.match(code, /if \(view === RUNNING\) \{[\s\S]{0,400}if \(!paused\) \{/);
  assert.match(code, /runStartMs \+= now\(\) - pausedAtMs/, 'resume must not lurch forward');
});

test('Back restarts, and the press after it leaves', () => {
  const back = code.match(/if \(d1 === CC_BACK\) \{([\s\S]*?)\n  \}\n/)[1];
  assert.match(back, /view === RUNNING[\s\S]{0,200}armRun\(\)/, 'Back must restart');
  assert.match(back, /shiftHeld[\s\S]{0,40}exitModule/, 'Shift+Back still leaves outright');
});

test('the missed-note rescue keys off the wait pointer, not the scoring cursor', () => {
  /* The scoring cursor moves past a note the moment it is missed, so anything
   * reading it can never light the note you actually need shown. */
  const fn = code.match(/function collectStuck\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(fn, /SCORE\.blockingNotes\(run\)/);
  assert.doesNotMatch(fn, /run\.cursor/);
  assert.match(fn, /settings\.guidance/, 'scoped to Guide pads, as chosen');
  assert.match(fn, /view !== RUNNING/, 'and it cannot fire in a quiz');
});

test('the LED decision lives in led_paint.mjs, where it can be tested', () => {
  /* It shipped three bugs while it was inline here, reachable only by regex. */
  assert.match(code, /LEDS\.padColors\(ledState, ledWorkspace, padColorBuf\)/);
  const paint = code.match(/function paintPads\(\) \{([\s\S]*?)\n\}/)[1];
  assert.doesNotMatch(paint, /LED_PRESSED|LED_TARGET_NEAR|ledPhase \?/, 'no colours decided inline');
});

test('the LED repaint is throttled, but a press still lights instantly', () => {
  /* It used to run at the full 500Hz tick, allocating ~68 objects a call, to
   * animate a pulse that changes twice a second. */
  assert.match(code, /LED_INTERVAL_MS = \d+/);
  assert.match(code, /if \(ledDirty \|\| \(view === RUNNING && t - lastLedMs >= LED_INTERVAL_MS\)\)/);
  const down = code.match(/function onPadDown\(pad, vel\) \{([\s\S]*?)\n\}/)[1];
  assert.match(down, /ledDirty = true/, 'a press must bypass the throttle');
});

test('the frame path reuses its buffers rather than rebuilding them', () => {
  assert.match(code, /const ledWorkspace = LEDS\.createLedState\(\)/);
  assert.match(code, /const padColorBuf = new Array\(PAD\.PAD_COUNT\)/);
  for (const buf of ['targetBuf', 'stuckBuf', 'soundingBuf']) {
    assert.match(code, new RegExp(buf + '\\.length = 0'), buf + ' must be reused');
  }
});

test('the frame keeps repainting while stuck, or the pulse would stall', () => {
  assert.match(code, /if \(blocked\) dirty = true/);
});

test('a changed default is migrated, because a saved file always wins over it', () => {
  /* Switching the default from "both" to "Move" does nothing on its own for
   * anyone who has already used the module: their settings.json still says 3.
   * v2 moves those over, and leaves a deliberate USB choice alone. */
  assert.ok(settingsVersion() >= 2, 'the version may not fall back past this migration');
  assert.match(code, /storedVersion < 2 && settings\.midiOut === \(OUT_TRACK \| OUT_USB\)[\s\S]{0,80}settings\.midiOut = OUT_TRACK/);
  const load = code.match(/function loadSettings\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(load, /settings\.version = SETTINGS_VERSION/);
  assert.match(load, /saveSettings\(\)/, 'the migration must persist');
});

test('a channel mismatch cannot silence the module', () => {
  assert.match(code, /midiCh: 0/, 'broadcast by default');
  const each = code.match(/function eachChannel\(fn\) \{([\s\S]*?)\n\}/)[1];
  assert.match(each, /settings\.midiCh === 0[\s\S]{0,120}ch < 16/);
  assert.ok(settingsVersion() >= 3, 'the version may not fall back past this migration');
  assert.match(code, /storedVersion < 3[\s\S]{0,40}settings\.midiCh = 0/);
});

test('MIDI is paced through an outbox so a chord cannot overrun the ring', () => {
  /* 3 notes x 16 channels is 48 packets against a 64-deep ring that drains 31
   * per audio block, and the reference line can be doing it in the same frame. */
  assert.match(code, /const outbox = \[\]/);
  assert.match(code, /OUTBOX_PER_TICK = \d+/);
  assert.match(code, /function queue\(route, status, d1, d2\)/);
  assert.match(code, /flushOutbox\(false\)/, 'drained every tick');
  assert.match(code, /flushOutbox\(true\)/, 'and fully before exit');
  assert.match(code, /OUTBOX_MAX/, 'bounded, so a stall cannot eat memory');
});

test('the ready screen says where the notes are going', () => {
  assert.match(code, /outLabel:[\s\S]{0,140}settingIndex\('midiCh'\)/);
});

test('the built-in piano is the default and needs nothing set up', () => {
  assert.match(code, /OUT_INTERNAL = 4/);
  assert.match(code, /midiOut: OUT_INTERNAL/);
  assert.match(code, /storedVersion < 4[\s\S]{0,60}settings\.midiOut = OUT_INTERNAL/);
});

test('chords reach the DSP in one write — the param channel is a single slot', () => {
  /* One call per note would have a chord overwrite itself in the mailbox and
   * only the last note would sound. */
  assert.match(code, /const dspNotes = \[\]/);
  assert.match(code, /dspSet\('n', dspNotes\.join\(','\)\)/);
  assert.match(code, /flushDsp\(\)/);
  assert.match(code, /function allNotesOff\(\)[\s\S]{0,200}dspSet\('panic'/);
});

test('Listen lights the pads it is playing, ungated', () => {
  /* Watching the notes light up is the whole point of the mode, so unlike the
   * guidance hint this must not sit behind Guide pads. */
  const fn = code.match(/function collectSounding\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(fn, /listening/);
  assert.doesNotMatch(fn, /settings\.guidance/, 'must not be gated on a setting');
  assert.match(fn, /pitchRefcount/, 'exactly what is sounding, not what is scheduled');
});

test('the guesser runs no clock — it waits for you, it does not time you', () => {
  const guessDraw = code.match(/view === GUESS_VIEW\) \{([\s\S]*?)\n  \} else if/);
  assert.ok(guessDraw, 'the guess view must have its own draw branch');
  const svc = code.match(/function serviceGuess\(\) \{([\s\S]*?)\n\}/)[1];
  assert.doesNotMatch(svc, /expireMissed|serviceClick|applyWait|songBeats/,
    'no part of the timing engine belongs here');
  /* Its note-offs run on wall time, since there are no beats to schedule on. */
  assert.match(svc, /atMs/);
});

test('nothing ever lights the answer in the quiz modes', () => {
  /* Guide pads is a PLAYING aid: in the reading mode the music is moving and a
   * hint keeps you with it. In a quiz the hint is the answer, so the setting
   * must not reach here at all — not even when it is on. */
  assert.doesNotMatch(code, /guessPads/, 'no answer-lighting path may exist');
  for (const fn of ['collectTarget', 'collectStuck', 'collectSounding']) {
    const body = code.match(new RegExp('function ' + fn + '\\(\\) \\{([\\s\\S]*?)\\n\\}'))[1];
    assert.doesNotMatch(body, /quiz/, fn + ' must not read the quiz');
    assert.match(body, /view !== RUNNING|!listening/, fn + ' is confined to the reading mode');
  }
});

test('the mode is entered from the list, and picks notes or chords by which row', () => {
  const menu = code.match(/function rebuildMenu\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(menu, /guess: GUESS\.NOTES/);
  assert.match(menu, /guess: GUESS\.CHORDS/);
  assert.match(code, /if \(row\.guess\)[\s\S]{0,100}startQuiz\(row\.guess, row\.hear, row\.pick\)/);
  assert.match(menu, /hear: true/, 'and the hearing rows are there too');
});

test('leaving the guesser silences it', () => {
  const back = code.match(/if \(d1 === CC_BACK\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(back, /view === READY \|\| view === GUESS_VIEW[\s\S]{0,80}allNotesOff\(\)/);
});

test('hearing mode plays the prompt and withholds the notation', () => {
  assert.match(code, /let quizHear = false/);
  /* Played when the quiz starts, when it moves on, and when Play is pressed. */
  assert.match(code, /if \(quizHear\) \{\s*\n\s*hearPrompt\(\);/);
  assert.match(code, /hidden: quizHear && !quiz\.solved/,
    'the answer is revealed only once it has been played');
  /* And the screen reader must not simply read the answer out. */
  assert.match(code, /announce\('Listen\.'\)/);
});

test('the quiz rebuilds itself on a key change, rather than calling a build it has no', () => {
  /* A quiz row is a mode, not an exercise, so it carries no build(). Turning
   * the key knob with one open used to throw. */
  const edit = code.match(/function editSetting\(index, delta\) \{([\s\S]*?)\n\}/)[1];
  assert.match(edit, /view === GUESS_VIEW && quiz[\s\S]{0,60}startQuiz\(quiz\.kind, quizHear\)/);
  assert.match(edit, /row && row\.build/, 'and the exercise path is guarded too');
});

test('the feedback flashes exist — they were deleted once and shipped', () => {
  /* "ReferenceError: 'flashPad' is not defined" on the first pad press. */
  assert.match(code, /function flashPad\(pad, color, ms\)/);
  assert.match(code, /function flashPitch\(pitch, color\)/);
});

test('the jog cannot change what you are playing', () => {
  const jog = code.match(/function onJog\(delta\) \{([\s\S]*?)\n\}/)[1];
  assert.doesNotMatch(jog, /selectExercise/, 'only Back then the list may do that');
  assert.doesNotMatch(jog, /'select'/);
  assert.match(jog, /next\.action !== 'cursor'/);
});

test('a finished round is recorded, and the history survives an update', () => {
  assert.match(code, /STATS\.makeRecord\(/);
  assert.match(code, /STATS\.addRecord\(stats, rec\)/);
  assert.match(code, /function saveStats\(\)[\s\S]{0,200}writeFile\(STATS_PATH/);
  assert.match(code, /STATS_PATH = MODULE_DIR \+ '\/stats\.json'/);
  /* The rate only means something within one drill. */
  assert.match(code, /function currentDrill\(\)[\s\S]{0,240}STATS\.drillId/);
});

test('the round clock is the module clock, not wall time', () => {
  /* performance.now() is monotonic; Date.now() can jump mid-round. */
  assert.match(code, /GUESS\.pressPitch\(quiz, pitch, now\(\)\)/);
  assert.match(code, /GUESS\.roundElapsed\(quiz, now\(\)\)/);
  /* The timestamp on the record is wall time, which is what a date needs. */
  assert.match(code, /at: Date\.now\(\)/);
});

test('the jog answers in the multiple-choice drill, and only there', () => {
  /* Everywhere else the jog only moves a highlight; here it is the input. */
  const jog = code.match(/function onJog\(delta\) \{([\s\S]*?)\n\}/)[1];
  assert.match(jog, /quizPick && quiz && !quiz\.solved[\s\S]{0,80}GUESS\.moveChoice/);
  const click = code.match(/function onJogClick\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(click, /quizPick[\s\S]{0,160}GUESS\.pickChoice/);
});

test('the lit pad is the question, so pressing pads does not answer it', () => {
  const down = code.match(/function onPadDown\(pad, vel\) \{([\s\S]*?)\n\}/)[1];
  assert.match(down, /quizPick[\s\S]{0,140}return;/);
  /* And the prompt is lit deliberately — the one place a quiz lights pads. */
  const fn = code.match(/function collectPrompt\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(fn, /quizPick/);
  assert.doesNotMatch(fn, /settings\.guidance/, 'the question is not a hint');
});

test('Record is the help button in a quiz, and no longer skips the question', () => {
  const rec = code.match(/if \(d1 === CC_RECORD\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(rec, /view === GUESS_VIEW[\s\S]{0,60}takeHint\(\)/);
  assert.doesNotMatch(rec, /GUESS\.nextPrompt/, 'skipping was dropped when help took the button');
});

test('the top rung lights the pads, and only there', () => {
  const fn = code.match(/function collectPrompt\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(fn, /quiz\.hint < GUESS\.MAX_HINT/, 'below the top rung the pads stay dark');
  assert.match(fn, /quizPick/, 'except in the picking drill, where the pad is the question');
});

test('hints are recorded, so the score does not quietly overstate the round', () => {
  assert.match(code, /hints: quiz\.hintsUsed/);
  assert.match(code, /GUESS\.hintsLeft\(quiz\)/);
});
