// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * App.jsx — Piano Practice in a browser window.
 *
 * One Ultraviolet window (EditorFrame: the ground, the hint bar, the
 * signature), a bar across the top, the screen the session is on, and the
 * keys under it. The window follows the session — the same screens, in the
 * same order, as on the Move — so what is learnt on one is where it is on the
 * other.
 */
import { Show, Switch, Match, For, createSignal, createEffect, onCleanup, onMount } from 'solid-js';
import { EditorFrame } from '../kit/components/EditorFrame.jsx';
import { Button } from '../kit/components/Button.jsx';
import { createStore } from './store.js';
import { ListView, PracticeView, QuizView, ResultView, ProgressView, SettingsView, InfoView, KeysPanel } from './views.jsx';
import { keyIntent, DEFAULT_OCTAVE_C } from '../input/keys.js';
import { connectMidi } from '../input/midi.js';

const PLOT = { w: 320, h: 120 };

/* The hint bar's conventions, per screen: what the keys do here. */
const HINTS = {
  menu: [['enter', 'opens'], ['esc', 'goes up'], ['I', 'explains']],
  ready: [['space', 'practises'], ['shift+space', 'listens'], ['A–;', 'play']],
  running: [['space', 'pauses'], ['esc', 'restarts'], ['A–;', 'play']],
  guess: [['A–;', 'play'], ['shift+?', 'helps'], ['esc', 'leaves']],
  summary: [['enter', 'next'], ['space', 'again'], ['esc', 'retry']],
  progress: [['click', 'a row for its chart'], ['esc', 'goes back']],
  'progress-detail': [['click', 'another row'], ['esc', 'the list']],
  settings: [['−/+', 'change a row'], ['esc', 'goes back']],
  info: [['esc', 'closes']],
};

function useMedia(query) {
  const m = window.matchMedia(query);
  const [on, setOn] = createSignal(m.matches);
  const update = () => setOn(m.matches);
  m.addEventListener('change', update);
  onCleanup(() => m.removeEventListener('change', update));
  return on;
}

/* A key press that belongs to the control in focus is left to it. */
function ownedByControl(e) {
  const t = e.target;
  if (!t || !t.closest) return false;
  if (t.closest('input, select, textarea, [contenteditable="true"]')) return true;
  if ((e.code === 'Space' || e.code === 'Enter') && t.closest('button, [role="option"], [role="radio"], .keyboard, .pads')) return true;
  return false;
}

export function App(props) {
  const store = createStore(props.backend);
  const vm = store.vm;
  const dispatch = store.dispatch;
  const narrow = useMedia('(max-width: 720px)');
  const [surface, setSurface] = createSignal('piano');
  const [octaveC, setOctaveC] = createSignal(DEFAULT_OCTAVE_C);
  const [audio, setAudio] = createSignal(props.piano ? props.piano.state : 'remote');
  const [midi, setMidi] = createSignal({ available: false, devices: [] });
  let ground = null;

  /*
   * What the session just said. The hint bar shows it for a few seconds and
   * then gives the bar back to the explanations under the pointer; the live
   * region keeps it for a screen reader.
   */
  const [said, setSaid] = createSignal('');
  let saidTimer = 0;
  let saidN = -1;
  createEffect(() => {
    const a = vm() && vm().announcement;
    if (!a || a.n === saidN) return;
    saidN = a.n;
    setSaid(a.text);
    clearTimeout(saidTimer);
    saidTimer = setTimeout(() => setSaid(''), 3500);
  });
  onCleanup(() => clearTimeout(saidTimer));

  /* Sound starts from a gesture, as browsers require: the first one anywhere. */
  const wake = () => {
    if (!props.piano) return;
    props.piano.resume().then(setAudio);
  };
  onMount(() => {
    window.addEventListener('pointerdown', wake, { capture: true });
    window.addEventListener('keydown', wake, { capture: true });
  });
  onCleanup(() => {
    window.removeEventListener('pointerdown', wake, { capture: true });
    window.removeEventListener('keydown', wake, { capture: true });
  });

  /* The computer keyboard: a piano, and the Move's buttons. */
  const down = new Map();      /* key code -> the pitch it started */
  const onKeyDown = (e) => {
    if (ownedByControl(e)) return;
    const intent = keyIntent(e, octaveC());
    if (!intent) return;
    e.preventDefault();
    if (e.repeat) return;
    if (intent.kind === 'note') {
      down.set(e.code, intent.pitch);
      store.noteOn(intent.pitch, 96);
    } else if (intent.kind === 'octave') {
      setOctaveC(intent.octaveC);
    } else {
      dispatch(intent.action);
    }
  };
  const onKeyUp = (e) => {
    const pitch = down.get(e.code);
    if (pitch === undefined) return;
    down.delete(e.code);
    store.noteOff(pitch);
  };
  const onBlur = () => {
    down.clear();
    store.releaseAll();
  };
  onMount(() => {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
  });
  onCleanup(() => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  });

  /* MIDI: any keyboard, or a Move on its cable. */
  onMount(async () => {
    const m = await connectMidi({
      onNote: (n) => (n.on ? store.noteOn(n.pitch, n.vel) : store.noteOff(n.pitch)),
      onDevices: (devices) => setMidi({ available: true, devices }),
      transpose: () => (vm() ? vm().key.transpose : 12),
    });
    setMidi({ available: m.available, denied: m.denied, devices: m.devices });
    onCleanup(() => m.close());
  });

  /* The ground breathes on each downbeat while the music runs. */
  createEffect(() => {
    const v = vm();
    if (!v || v.screen !== 'running' || v.clock.paused) return;
    let lastBar = -1;
    let raf = 0;
    const watch = () => {
      const c = store.clock();
      if (c && c.beats >= 0 && c.bar !== lastBar && !c.blocked) {
        if (lastBar !== -1 && ground) ground.trigger(c.listening ? 0.6 : 0.9);
        lastBar = c.bar;
      }
      raf = requestAnimationFrame(watch);
    };
    raf = requestAnimationFrame(watch);
    onCleanup(() => cancelAnimationFrame(raf));
  });

  const atTop = () => vm() && vm().screen === 'menu' && vm().nav && vm().nav.path.length <= 1;
  const crumb = () => {
    const v = vm();
    if (!v) return '';
    if (v.screen === 'menu') return v.nav ? v.nav.path.slice(1).join(' › ') : '';
    if (v.chart) return v.chart.name;
    if (v.quiz) return v.quiz.title || 'Quiz';
    return { settings: 'Settings', progress: 'Progress', 'progress-detail': 'Progress', info: 'Info', summary: 'Result' }[v.screen] || '';
  };
  const audioLabel = () => ({
    running: 'sound on', idle: 'sound: tap to start', suspended: 'sound: tap to start', loading: 'sound: starting',
    unavailable: 'no sound here', error: 'sound failed', closed: 'sound off', remote: 'sound on the Move',
  }[audio()] || audio());
  const midiLabel = () => {
    const m = midi();
    if (!m.available) return m.denied ? 'MIDI refused' : 'no MIDI';
    if (!m.devices.length) return 'MIDI: none';
    return m.devices.length === 1 ? m.devices[0].name : `${m.devices.length} MIDI inputs`;
  };

  const extraSettings = () => (
    <div class="panel browser-settings">
      <h2 class="t-label">This browser</h2>
      <p class="t-hint">Computer keys: A–; from {['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'][octaveC() / 12 - 2] || ''} · Z and X move the octave</p>
      <p class="t-hint">MIDI: <Show when={midi().available} fallback={midi().denied ? 'the browser refused access' : 'not available in this browser'}>
        <Show when={midi().devices.length} fallback="no inputs connected">
          <For each={midi().devices}>{(d, i) => <>{i() ? ', ' : ''}{d.name}{d.move ? ' (pads)' : ''}</>}</For>
        </Show>
      </Show></p>
      <p class="t-hint">Settings, progress and rounds are kept in this browser only.</p>
    </div>
  );

  return (
    <EditorFrame class="app-window" motionKey="piano-practice"
                 hint={HINTS[vm() ? vm().screen : 'menu'] || []}
                 status={said() ? [said(), ''] : null}
                 signatureInfo="Neon Ingvy — Piano Practice"
                 onGround={(h) => { ground = h; }}>
      <div class="app" classList={{ narrow: narrow() }}>
        <p class="sr-only" aria-live="polite">{vm() && vm().announcement ? vm().announcement.text : ''}</p>
        <nav class="app-bar" aria-label="Piano Practice">
          <Button icon="chevron" title="Back" ariaLabel="Back" disabled={atTop()}
                  info="Back — up a level; from a run, back to its start"
                  onClick={() => dispatch({ type: 'back' })} />
          <div class="app-title">
            <span class="t-title">Piano Practice</span>
            <Show when={crumb()}><span class="t-hint app-crumb">{crumb()}</span></Show>
          </div>
          <div class="app-status t-hint" aria-live="polite">
            <button class="status-pill" classList={{ live: audio() === 'running' }} onClick={wake}
                    data-info="The browser's own piano: the Move's, compiled for the web">{audioLabel()}</button>
            <span class="status-pill midi" classList={{ live: midi().devices.length > 0 }}>{midiLabel()}</span>
          </div>
          <Button info="Info — what this is, and its words" onClick={() => dispatch({ type: 'info' })}>Info</Button>
          <Show when={vm() && vm().screen === 'menu'}>
            <Button info="Settings" onClick={() => dispatch({ type: 'settings' })}>Settings</Button>
          </Show>
        </nav>

        <div class="app-main">
          <Show when={vm()}>
            <Switch>
              <Match when={vm().screen === 'menu'}><ListView vm={vm} dispatch={dispatch} /></Match>
              <Match when={vm().screen === 'ready' || vm().screen === 'running'}>
                <PracticeView vm={vm} store={store} dispatch={dispatch} narrow={narrow} />
              </Match>
              <Match when={vm().screen === 'guess'}><QuizView vm={vm} dispatch={dispatch} /></Match>
              <Match when={vm().screen === 'summary'}><ResultView vm={vm} dispatch={dispatch} /></Match>
              <Match when={vm().screen === 'progress' || vm().screen === 'progress-detail'}>
                <ProgressView vm={vm} dispatch={dispatch} plot={PLOT} />
              </Match>
              <Match when={vm().screen === 'settings'}>
                <SettingsView vm={vm} dispatch={dispatch} remote={!props.piano} extra={extraSettings()} />
              </Match>
              <Match when={vm().screen === 'info'}><InfoView vm={vm} dispatch={dispatch} /></Match>
            </Switch>
          </Show>
        </div>

        <Show when={vm() && vm().screen !== 'info' && vm().screen !== 'settings'}>
          <KeysPanel vm={vm} store={store} dispatch={dispatch} narrow={narrow}
                     surface={surface} setSurface={setSurface} />
        </Show>
      </div>
    </EditorFrame>
  );
}
