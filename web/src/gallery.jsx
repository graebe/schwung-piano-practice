// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * The component gallery: every kit and music component in its states, on
 * static data, for review by eye and for screenshots.
 *
 * Still by default, so a screenshot is the same every time; `?play` (or the
 * Play button) sets the staff moving at the song's tempo.
 */
import { render } from 'solid-js/web';
import { For, Show, createSignal } from 'solid-js';

import './styles/tokens.gen.css';
import './styles/base.css';
import './kit/components.css';
import './music/music.css';
import './gallery.css';

import { Button } from './kit/components/Button.jsx';
import { Toggle } from './kit/components/Toggle.jsx';
import { Select } from './kit/components/Select.jsx';
import { Knob } from './kit/components/Knob.jsx';
import { Tabs } from './kit/components/Tabs.jsx';
import { Signature } from './kit/components/Signature.jsx';
import { Icon } from './kit/components/Icon.jsx';
import { EditorFrame } from './kit/components/EditorFrame.jsx';
import { ICONS } from './kit/lib/icons.js';
import { GrandStaff } from './music/GrandStaff.jsx';
import { Keyboard } from './music/Keyboard.jsx';
import { PadGrid } from './music/PadGrid.jsx';
import { spokenName } from './music/staff.js';

import system from '../design/ultraviolet-tokens.json' with { type: 'json' };
import practice from '../design/practice-tokens.json' with { type: 'json' };
import ode from '../../src/exercises/ode-to-joy.json' with { type: 'json' };
import thirds from '../../src/exercises/techno-thirds-cycle.json' with { type: 'json' };
import minuet from '../../src/exercises/minuet-in-g.json' with { type: 'json' };
import { chartTotalBeats, msToBeats } from '../../src/chart.mjs';

/* ------------------------------------------------------------ data -- */

/* An exercise's events in beat order, each with its index: Ode to Joy at
 * level 3 is both hands, as written. */
const indexed = (song) => [...song.events].sort((a, b) => a.beat - b.beat || (a.hand < b.hand ? -1 : 1))
  .map((e, index) => ({ ...e, index }));

const odeEvents = indexed(ode);
const NOW = 12;

/* A run that has reached beat 12: everything before it judged, mostly well,
 * with one late chord, one wrong note and a miss; markers where the keys
 * went down, a little early or late. */
const odeJudgements = odeEvents.map((e) => {
  if (e.beat >= NOW) return 'pending';
  if (e.beat === 5) return 'late';
  if (e.beat === 7) return 'missed';
  if (e.beat === 4 && e.hand === 'r') return ['hit', 'good', 'hit'];
  return e.beat % 2 ? 'good' : 'hit';
});
const odeMarkers = odeEvents.filter((e) => e.beat < NOW && e.beat !== 7).flatMap((e) =>
  e.pitches.map((pitch, j) => ({ beat: e.beat + [-0.06, 0.04, 0.12][(e.beat + j) % 3] + (e.beat === 5 ? 0.3 : 0), pitch })))
  .concat([{ beat: 7.15, pitch: 73, stray: true }]);
const odeBlocking = odeEvents.find((e) => e.beat === NOW && e.hand === 'r')?.index ?? null;

const colours = [...system.color.tokens, ...practice.color.tokens];
const styles = system.type.groups.flatMap((g) => g.styles);

/* --------------------------------------------------------- helpers -- */

function Section(props) {
  return (
    <section class="g-section">
      <header class="g-section-head">
        <h2 class="t-title">{props.title}</h2>
        <Show when={props.note}><p class="t-hint">{props.note}</p></Show>
      </header>
      {props.children}
    </section>
  );
}

function Demo(props) {
  return (
    <figure class="g-demo">
      <figcaption class="t-label">{props.label}</figcaption>
      {props.children}
      <Show when={props.note}><p class="g-note t-hint">{props.note}</p></Show>
    </figure>
  );
}

function Legend(props) {
  return (
    <ul class="g-legend t-hint">
      <For each={props.items}>{([cls, text]) => (
        <li><i class={`g-swatch ${cls}`} aria-hidden="true" />{text}</li>
      )}</For>
    </ul>
  );
}

/* ----------------------------------------------------------- page -- */

function Gallery() {
  /* The staff's clock: still at beat 12 unless playing. */
  const [playing, setPlaying] = createSignal(new URLSearchParams(location.search).has('play'));
  const total = chartTotalBeats({ events: ode.events });
  let started = performance.now();
  const moving = () => (msToBeats(performance.now() - started, ode.bpm) % (total + 4)) - 2;
  const beats = () => (playing() ? moving : NOW);

  const [tempo, setTempo] = createSignal((72 - 40) / 160);
  const [grace, setGrace] = createSignal(0.25);
  const [level, setLevel] = createSignal(3);
  const [tab, setTab] = createSignal(0);
  const [wait, setWait] = createSignal(true);
  const [click, setClick] = createSignal(false);
  const [log, setLog] = createSignal('Press, or drag across the keys.');
  const [padLog, setPadLog] = createSignal('Press a pad, or an answer.');
  let ground = null;

  const bpm = () => Math.round(40 + tempo() * 160);
  const tempoDetents = [60, 80, 100, 120].map((b) => (b - 40) / 160);

  return (
    <div class="gallery">
      <header class="g-head">
        <div>
          <h1 class="t-title">Piano Practice</h1>
          <p class="t-hint">Components · Ultraviolet {system.meta.release}</p>
        </div>
        <Signature />
      </header>

      <Section title="Foundations" note="tokens.gen.css, generated from the design system's tokens.json and this app's practice-tokens.json">
        <div class="g-swatches">
          <For each={colours}>{(t) => (
            <div class="g-colour" title={t.usage}>
              <i style={{ background: `var(--${t.name})` }} />
              <span class="t-hint">{t.name}</span>
            </div>
          )}</For>
        </div>
        <div class="g-type">
          <For each={styles}>{(s) => (
            <div class="g-type-row">
              <span class="t-hint g-type-name">{s.name}</span>
              <span class={`t-${s.name}`}>{s.sample}</span>
            </div>
          )}</For>
        </div>
        <div class="g-icons">
          <For each={Object.keys(ICONS).sort()}>{(name) => (
            <span class="g-icon" title={name}><Icon name={name} /><span class="t-hint">{name}</span></span>
          )}</For>
        </div>
      </Section>

      <Section title="Controls" note="The ui-kit, copied: an EditorFrame (fluid) with its ground, Hint bar, Motion switch and Signature">
        <EditorFrame class="g-frame" motionKey="gallery"
                     hint={[['drag', 'a knob to set it'], ['click', 'a readout to type'], ['tab', 'to the keys']]}
                     onGround={(h) => { ground = h; }}>
          <div class="g-controls">
            <section class="panel g-panel">
              <h2 class="t-title">Transport</h2>
              <div class="g-stack">
                <div class="btn-group">
                  <Button icon="play" title="Play" on={playing()} info="Play — the staff scrolls at the song's tempo"
                          onClick={() => { started = performance.now(); setPlaying(!playing()); }} />
                  <Button icon="pause" title="Pause" />
                  <Button icon="stop" title="Stop" onClick={() => setPlaying(false)} />
                </div>
                <Button icon="reset" onClick={() => ground?.trigger(1)} info="Ring — one downbeat through the ground">Ring</Button>
                <Button icon="export" disabled>Export</Button>
              </div>
            </section>
            <section class="panel g-panel">
              <h2 class="t-title">Practice</h2>
              <div class="knob-row">
                <Knob label="Tempo" value={tempo()} display={`${bpm()} bpm`} detents={tempoDetents}
                      info="Tempo — 40 to 200 bpm" onInput={setTempo} onReset={() => setTempo((72 - 40) / 160)} />
                <Knob label="Grace" value={grace()} display={`${Math.round(grace() * 4 * 4) / 4} beat`}
                      info="Grace — how late a note may be and still count" onInput={setGrace} />
              </div>
              <div class="g-stack">
                <Toggle label="Wait" value={wait()} onChange={setWait} info="Wait — the scroll stops at a note until it is played" />
                <Toggle label="Click" value={click()} onChange={setClick} info="Click — a metronome" />
                <Select label="Level" labelWidth={48} width={168} value={level()} onChange={setLevel}
                        options={['L1 RH melody', 'L1 LH bass', 'L2 RH chords', 'L3 Both hands']}
                        info="Level — which part of the song to play" />
              </div>
            </section>
            <section class="panel g-panel g-tabs-panel">
              <Tabs tabs={['Read', 'Hear']} active={tab()} onSelect={setTab} label="Mode"
                    infos={['Read — play what the staff shows', 'Hear — play back what you heard']} />
            </section>
          </div>
        </EditorFrame>
      </Section>

      <Section title="Grand staff" note="GrandStaff.jsx: the chart lane. Still at beat 12 for review; Play scrolls it.">
        <Demo label="Ode to Joy · L3, both hands · judged up to beat 12, waiting on beat 12"
              note="Open heads are hits (lit: on time; uv: good; muted: late), the x a miss. Rings are where the keys went down; the red one a stray.">
          <GrandStaff events={odeEvents} judgements={odeJudgements} markers={odeMarkers}
                      fifths={ode.keySig} timeSig={ode.timeSig} beats={beats()} hitX={0.55} pxPerBeat={64}
                      blockingIndex={playing() ? null : odeBlocking} />
        </Demo>
        <Demo label="Techno thirds cycle · key changes and chord symbols">
          <GrandStaff events={indexed(thirds)} fifths={thirds.keySig} keyChanges={thirds.keyChanges}
                      timeSig={thirds.timeSig} beats={2} hitX={0.2} />
        </Demo>
        <Demo label="Minuet in G · 3/4, one sharp, compact">
          <GrandStaff events={indexed(minuet)} fifths={minuet.keySig} timeSig={minuet.timeSig}
                      beats={0} space={8} hitX={0.18} />
        </Demo>
        <Demo label="Every key signature, both clefs">
          <div class="g-keys">
            <For each={[-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7]}>{(f) => (
              <div class="g-key">
                <GrandStaff events={[]} fifths={f} timeSig={null} beats={0} space={6} showNames={false} hitLine={false} />
                <span class="t-hint">{f === 0 ? 'none' : `${Math.abs(f)} ${f > 0 ? 'sharp' : 'flat'}${Math.abs(f) > 1 ? 's' : ''}`}</span>
              </div>
            )}</For>
          </div>
        </Demo>
      </Section>

      <Section title="Keyboard" note="Keyboard.jsx: display only unless playable.">
        <Demo label="States">
          <Keyboard lowest={48} octaves={3} bass={48}
                    states={{ 48: 'lit', 60: 'lit', 64: 'lit', 67: 'lit', 74: 'target', 75: 'target',
                              65: 'held', 69: 'hit', 71: 'miss', 55: 'dim', 58: 'dim' }} />
          <Legend items={[['lit', 'lit — sounds'], ['target', 'target — next'], ['held', 'held — your finger'],
                          ['hit', 'hit'], ['miss', 'miss'], ['dim', 'dim — held over']]} />
        </Demo>
        <Demo label="Playable · press, drag for a glissando, or Tab in and use the arrows and Space" note={log()}>
          <Keyboard lowest={60} octaves={2} playable height={112}
                    states={{ 64: 'target' }}
                    onNoteOn={(p, v) => setLog(`${spokenName(p)} on, velocity ${v}`)}
                    onNoteOff={(p) => setLog(`${spokenName(p)} off`)} />
        </Demo>
      </Section>

      <Section title="Pads" note="PadGrid.jsx: Move's grid, one semitone right and five up, transposed +12.">
        <div class="g-pads">
          <Demo label="Reading · C major">
            <PadGrid rootPc={0} showNames
                     states={{ 64: 'now', 67: 'coming', 65: 'held', 60: 'hit', 62: 'miss' }} />
            <Legend items={[['off', 'out of key'], ['scale', 'in key'], ['root', 'root'], ['coming', 'coming'],
                            ['now', 'now'], ['held', 'held'], ['hit', 'hit'], ['miss', 'miss']]} />
          </Demo>
          <Demo label="Quiz · four answers, one struck out · playable" note={padLog()}>
            <PadGrid rootPc={7} fifths={1} playable
                     answers={[{ label: 'Major 3rd', key: 'M3' }, { label: 'Minor 3rd', key: 'm3' },
                               { label: 'Perfect 5th', key: 'P5', struck: true }, { label: 'Octave', key: 'P8' }]}
                     onAnswer={(i) => setPadLog(`Answer ${i + 1}`)}
                     onNoteOn={(p, v) => setPadLog(`${spokenName(p, 1)} on, velocity ${v}`)}
                     onNoteOff={(p) => setPadLog(`${spokenName(p, 1)} off`)} />
          </Demo>
          <Demo label="Quiz · six answers">
            <PadGrid rootPc={null}
                     answers={['m2', 'M2', 'm3', 'M3', 'P4', 'TT'].map((key) => ({ key, label: key }))} />
          </Demo>
        </div>
      </Section>
    </div>
  );
}

const root = document.getElementById('gallery');
const dispose = render(() => <Gallery />, root);
if (import.meta.hot) import.meta.hot.dispose(dispose);
