// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * views.jsx — one component per screen of the session (vm.screen), and the
 * keys panel under them. Each reads the view model and dispatches actions;
 * none of them knows whether the session runs here or on a Move.
 */
import { For, Show, Switch, Match, createSignal, createMemo, onCleanup, onMount } from 'solid-js';
import { Button } from '../kit/components/Button.jsx';
import { GrandStaff } from '../music/GrandStaff.jsx';
import { NameRow } from '../music/NameRow.jsx';
import { createGlide } from '../music/glide.js';
import { Keyboard } from '../music/Keyboard.jsx';
import { PadGrid } from '../music/PadGrid.jsx';
import { AnswersChart, AttemptsChart, RoundsChart, TimelineChart } from './charts.jsx';
import { staffEvents, staffJudgements, staffMarkers } from './chart-view.js';
import { keyboardRange } from './feedback.js';
import { MODES } from '../../../src/generator.mjs';

const MARKS = { done: '✓', half: '◐', skip: '⤼', next: 'next' };
const MARK_INFO = { done: 'both stages passed', half: 'stage 1 passed', skip: 'skipped', next: 'the next step' };

/* The playhead, every animation frame while the music moves; still otherwise. */
function createFrameClock(store) {
  const [clock, setClock] = createSignal(store.clock());
  let raf = 0;
  const loop = () => {
    setClock(store.clock());
    raf = requestAnimationFrame(loop);
  };
  onMount(() => { raf = requestAnimationFrame(loop); });
  onCleanup(() => cancelAnimationFrame(raf));
  return clock;
}

/* ---- The lesson list ------------------------------------------------------ */

export function ListView(props) {
  const nav = () => props.vm().nav;
  return (
    <section class="screen list-screen" aria-labelledby="list-title">
      <header class="screen-head">
        <h1 id="list-title" class="t-title">{nav() ? nav().title : ''}</h1>
        <Show when={nav() && nav().path.length > 1}>
          <p class="t-hint crumbs">{nav().path.slice(0, -1).join(' › ')}</p>
        </Show>
      </header>
      <ul class="rows" role="listbox" aria-labelledby="list-title">
        <For each={nav() ? nav().rows : []}>{(row, i) => (
          <li>
            <button class="row" classList={{ on: i() === nav().cursor, folder: row.folder }}
                    role="option" aria-selected={i() === nav().cursor}
                    data-info={row.folder ? `${row.label} — open the folder` : `${row.label} — open it`}
                    onClick={() => { props.dispatch({ type: 'select', index: i() }); props.dispatch({ type: 'open' }); }}>
              <span class="row-label">{row.label}</span>
              <Show when={row.mark}>
                <span class={`row-mark mark-${row.mark}`} title={MARK_INFO[row.mark]}>{MARKS[row.mark] || row.mark}</span>
              </Show>
              <span class="row-value">{row.value === '>' ? '' : row.value.replace(/\s*>$/, '')}</span>
              <Show when={row.folder}><span class="row-chevron" aria-hidden="true">›</span></Show>
            </button>
          </li>
        )}</For>
      </ul>
    </section>
  );
}

/* ---- Practice: ready and running -------------------------------------------- */

export function PracticeView(props) {
  const vm = () => props.vm();
  const clock = createFrameClock(props.store);
  const running = () => vm().screen === 'running';
  const moving = () => running() && vm().clock.running && !vm().clock.paused && !vm().clock.blocked;
  /* BY IDENTITY: the chart and the run are the same objects across updates
   * until they change (a Move's backend keeps a field it did not receive
   * again), so the staff's notes are laid out once per piece, not once per
   * update. A memo on vm() alone would rebuild them on every one. */
  const chart = createMemo(() => vm().chart);
  const run = createMemo(() => vm().run);
  const events = createMemo(() => staffEvents(chart()));
  const judgements = createMemo(() => staffJudgements(chart(), run()));
  const markers = createMemo(() => staffMarkers(chart(), run()));
  const total = () => (vm().chart ? vm().chart.total : 0);
  const beats = () => (clock() ? clock().beats : 0);
  const stats = () => vm().run && vm().run.stats;
  const listening = () => vm().clock.listening;
  const countIn = () => running() && beats() < 0 ? Math.ceil(-beats()) : 0;
  const position = () => {
    const c = clock();
    if (!c || c.beats < 0) return running() ? 'count-in' : 'from the top';
    return `bar ${c.bar} · beat ${c.beat}`;
  };
  return (
    <section class="screen practice-screen" aria-labelledby="piece-title">
      <header class="screen-head practice-head">
        <div>
          <h1 id="piece-title" class="t-title">{vm().chart ? vm().chart.name : ''}</h1>
          <p class="t-hint">
            {keyName(vm())} · {vm().chart ? vm().chart.bpm : ''} bpm · {position()}
          </p>
        </div>
        <Show when={vm().armed}>
          <div class="segmented" role="radiogroup" aria-label="Stage">
            <Button on={vm().armed.stage === 1} info="Stage 1 — the next notes light on the keys and pads"
                    onClick={() => props.dispatch({ type: 'stage', stage: 1 })}>Stage 1 · lit</Button>
            <Button on={vm().armed.stage === 2} info="Stage 2 — nothing lights: reading alone"
                    onClick={() => props.dispatch({ type: 'stage', stage: 2 })}>Stage 2 · read</Button>
          </div>
        </Show>
      </header>

      <div class="staff-wrap" classList={{ paused: vm().clock.paused, waiting: vm().clock.blocked }}>
        <GrandStaff events={events()} judgements={judgements()} markers={markers()}
                    fifths={vm().chart ? vm().chart.keySig : 0} keyChanges={vm().chart ? vm().chart.keyChanges : []}
                    spelling={vm().chart ? vm().chart.spelling : null}
                    showNames={vm().names !== false}
                    timeSig={vm().chart ? vm().chart.timeSig : null}
                    blockingIndex={vm().run && vm().run.blockIndex >= 0 ? vm().run.blockIndex : null}
                    beats={moving() ? () => { const c = props.store.clock(); return c ? c.beats : 0; } : beats()}
                    space={props.narrow() ? 8 : 12}
                    pxPerBeat={props.narrow() ? 5 * 8 : 8 * 12}
                    label={`${vm().chart ? vm().chart.name : ''} on a grand staff`} />
        <Show when={countIn()}>
          <div class="count-in" aria-live="assertive">{countIn()}</div>
        </Show>
        <Show when={vm().clock.paused}>
          <div class="staff-badge t-label">Paused</div>
        </Show>
        <Show when={vm().clock.blocked}>
          {/* Stage 1 lights it; stage 2 names it only once it has waited. */}
          <div class="staff-badge t-label">
            {vm().armed && vm().armed.stage === 2
              ? (vm().stuckName ? `Waiting for ${vm().stuckName}` : 'Waiting')
              : 'Waiting for the lit note'}
          </div>
        </Show>
      </div>

      <div class="transport">
        <div class="btn-group">
          <Button icon="play" on={running() && listening() && !vm().clock.paused}
                  info="Listen — it plays itself and the keys light; again to pause"
                  onClick={() => props.dispatch({ type: 'listen' })}>Listen</Button>
          <Button icon="record" on={running() && !listening() && !vm().clock.paused}
                  info="Practice — you play, it scores; again to pause"
                  onClick={() => props.dispatch({ type: 'practice' })}>Practice</Button>
          <Button icon="reset" info="Back to the start" onClick={() => props.dispatch({ type: 'back' })}
                  disabled={!running()}>Restart</Button>
        </div>
        <label class="scrub" data-info="Scrub — pick the bar to start from, while the music is parked">
          <span class="t-label">Start at</span>
          <input type="range" min="0" max={total()} step="0.25" value={Math.max(0, beats())}
                 disabled={!vm().can.scrub} aria-label="Start position in beats"
                 onInput={(e) => props.dispatch({ type: 'scrubTo', beat: Number(e.currentTarget.value) })} />
        </label>
        <div class="tempo" data-info="Tempo — for generated drills; a song keeps its own">
          <Button title="Slower" ariaLabel="Slower" onClick={() => props.dispatch({ type: 'tempo', delta: -5 })}>−</Button>
          <span class="pp-value">{vm().chart ? vm().chart.bpm : ''}</span>
          <Button title="Faster" ariaLabel="Faster" onClick={() => props.dispatch({ type: 'tempo', delta: 5 })}>+</Button>
        </div>
        <Show when={stats() && running() && !listening()}>
          <p class="score t-value" aria-live="polite">
            <strong>{stats().hits}</strong>/{stats().total} hit
            <Show when={stats().strays}> · {stats().strays} wrong</Show>
          </p>
        </Show>
      </div>
    </section>
  );
}

function keyName(vm) {
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  if (vm.chart && vm.chart.source === 'file') {
    const k = vm.chart.keySig || 0;
    const major = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'][k + 7];
    return `key of ${major}`;
  }
  return `${vm.key.root || names[vm.key.rootPc]} ${vm.key.modeLabel}`;
}

/* ---- Quiz ------------------------------------------------------------------ */

export function QuizView(props) {
  const q = () => props.vm().quiz;
  const title = () => {
    const quiz = q();
    if (!quiz) return '';
    if (quiz.mode === 'ear') return quiz.title;
    const what = quiz.kind === 'chords' ? 'chord' : 'note';
    if (quiz.mode === 'pick') return `Name the ${what}`;
    if (quiz.mode === 'hear') return `Hear the ${what}`;
    return `Play the ${what}`;
  };
  const ask = () => {
    const quiz = q();
    if (quiz.mode === 'ear') return quiz.solved ? quiz.label || '' : quiz.question || 'Listen, then answer.';
    if (quiz.mode === 'pick') return quiz.solved ? 'Right.' : 'Which is lit?';
    if (quiz.mode === 'hear') return quiz.solved ? 'That was it.' : 'Listen, then play it back.';
    if (quiz.solved) return 'Right.';
    /* Help names a staff drill's prompt here, not under the staff: a name lane
     * would name the ones coming up too. */
    if (quiz.read === 'staff' && quiz.queue[0]?.name) return `It is ${quiz.queue[0].name}.`;
    if (quiz.read === 'staff') return 'Play what is written.';
    if (quiz.read === 'name') return 'Play it — any octave.';
    return 'Play it.';
  };
  const promptEvents = () => (q() && q().prompt ? [{ beat: 0, durBeats: 1, pitches: q().prompt, index: 0, symbol: q().label }] : []);
  const showStaff = () => q() && !q().read && (q().mode === 'play' || q().mode === 'hear');
  const what = () => (q().kind === 'chords' ? 'chord' : 'note');

  /* A Play drill's row on the staff, as a song's notes: one beat per prompt,
   * the prompt on the hit line, the one just played kept while it leaves. */
  const head = () => (q()?.queue?.[0]?.index ?? 0);
  const rowEvents = createMemo((prev) => {
    const queue = q()?.queue ?? [];
    /* No length: a prompt is a pitch to find, not a note to hold. */
    const events = queue.map((e) => ({ beat: e.index, durBeats: 0, pitches: e.pitches, index: e.index }));
    const before = prev.find((e) => e.index === head() - 1);
    return before ? [before, ...events] : events;
  }, []);
  const rowJudgements = () => {
    const out = { [head() - 1]: 'hit' };
    out[head()] = q().solved ? 'hit' : 'pending';
    return out;
  };
  /* The row moves on as soon as the answer is right, while the session still
   * holds the old prompt — so the queue's shift lands where the glide ends. */
  const glide = createGlide();
  const rowBeats = () => glide(head() + (q()?.solved ? 1 : 0));
  return (
    <Show when={q()}>
      <section class="screen quiz-screen" aria-labelledby="quiz-title">
        <header class="screen-head">
          <h1 id="quiz-title" class="t-title">{title()}</h1>
          <p class="t-hint">
            <Show when={q().roundSize > 0} fallback={`${q().correct} right · open practice`}>
              {q().correct} of {q().roundSize}
            </Show>
            {' '}· streak {q().streak}
          </p>
        </header>
        <div class="quiz-stage">
          <p class="quiz-ask t-value" aria-live="polite">{ask()}</p>
          <Show when={showStaff()}>
            <div class="quiz-staff" classList={{ hidden: !q().prompt }}>
              <Show when={q().prompt} fallback={<div class="quiz-hidden" aria-label="hidden until you play it">?</div>}>
                <GrandStaff events={promptEvents()} fifths={q().fifths} spelling={q().spelling} timeSig={null} beats={0} hitX={0.5}
                            hitLine={false} judgements={[q().solved ? 'hit' : 'pending']}
                            label={`The ${q().kind === 'chords' ? 'chord' : 'note'} to play`} />
              </Show>
            </div>
          </Show>
          <Show when={q().sheet}>
            <div class="quiz-staff quiz-row">
              {/* Half a beat back, so no note sits on the hit line and lights as "now". */}
              <GrandStaff events={q().sheet} fifths={0} timeSig={null} beats={-0.5} hitX={0.06}
                          pxPerBeat={Math.min(60, 520 / Math.max(1, q().sheet.length))}
                          hitLine={false} showNames={false} barLines={false}
                          label={`The ${q().title || 'prompt'} to read`} />
            </div>
          </Show>
          <Show when={q().read === 'staff'}>
            <div class="quiz-staff quiz-row">
              <GrandStaff events={rowEvents()} judgements={rowJudgements()} fifths={q().fifths} spelling={q().spelling} timeSig={null}
                          beats={rowBeats} hitX={0.2} showNames={false} barLines={false}
                          blockingIndex={q().solved ? null : head()}
                          label={`The ${what()} to play, and the ones after it`} />
            </div>
          </Show>
          <Show when={q().read === 'name'}>
            <div class="quiz-row">
              <NameRow items={q().queue} solved={q().solved} label={`The ${what()} to play, and the ones after it`} />
            </div>
          </Show>
          <Show when={q().options.length}>
            <div class="options" role="group" aria-label="Answers">
              <For each={q().options}>{(o, i) => (
                <button class="option" classList={{ on: i() === q().choice && !q().solved, out: o.out }}
                        disabled={o.out || q().solved}
                        data-info={`${o.label} — answer`}
                        onClick={() => props.dispatch({ type: 'answer', index: i() })}>
                  <Show when={o.colour}><span class={`chip answer-${o.colour}`} aria-hidden="true" /></Show>
                  <span>{o.label}</span>
                </button>
              )}</For>
            </div>
          </Show>
        </div>
        <div class="transport">
          <div class="btn-group">
            <Show when={q().mode !== 'pick'}>
              <Button icon="play" info="Hear it again" onClick={() => props.dispatch({ type: 'hear' })}>Hear</Button>
            </Show>
            <Button disabled={!q().hintsLeft} info="Help — a step at a time; the round counts how many you took"
                    onClick={() => props.dispatch({ type: 'hint' })}>
              Help {q().hint}/{q().maxHint}
            </Button>
          </div>
        </div>
      </section>
    </Show>
  );
}

/* ---- Result ---------------------------------------------------------------- */

export function ResultView(props) {
  const r = () => props.vm().result;
  const passed = () => (r().passed === 2 ? 'Finished ✓' : r().passed === 1 ? 'Stage 1 passed ◐' : '');
  return (
    <Show when={r()}>
      <section class="screen result-screen" aria-labelledby="result-title">
        <Switch>
          <Match when={r().kind === 'exercise'}>
            <header class="screen-head">
              <h1 id="result-title" class="t-title">{r().name} · stage {r().stage}</h1>
              <p class="t-hint">{passed()}{r().isBest ? ' · best yet' : ''}</p>
            </header>
            <div class="hero">
              <span class="hero-number">{Math.round(r().percent)}<small>%</small></span>
              <span class="t-value">{r().hits} of {r().total} hit{r().wrong ? ` · ${r().wrong} wrong` : ''}</span>
            </div>
            <Show when={r().timing && r().timing.hits}>
              <p class="t-value timing-line">
                in time {r().timing.inTime}% · early {r().timing.early}% · late {r().timing.late}%
                <Show when={r().timing.lean}>
                  {' · '}<strong>{r().timing.lean === 'rush' ? 'rushing' : 'dragging'}</strong>
                  {` (${r().timing.meanMs > 0 ? '+' : ''}${r().timing.meanMs} ms)`}
                </Show>
              </p>
            </Show>
            <AttemptsChart history={r().history} />
          </Match>
          <Match when={r().kind === 'quiz'}>
            <header class="screen-head">
              <h1 id="result-title" class="t-title">Round done</h1>
              <p class="t-hint">{passed()}{r().isBest ? ' · best yet' : ''}</p>
            </header>
            <div class="hero">
              <span class="hero-number">{Math.round(r().rate)}<small>/min</small></span>
              <span class="hero-number">{r().success}<small>% right</small></span>
              <span class="t-value">
                {r().n} in {Math.round(r().ms / 1000)}s · {r().wrong} wrong
                {r().hints ? ` · ${r().hints} hint${r().hints > 1 ? 's' : ''}` : ''}
                {r().best > 0 && !r().isBest ? ` · best ${Math.round(r().best)}/min` : ''}
              </span>
            </div>
            <RoundsChart records={r().records} />
            <Show when={r().answers && r().answers.length}>
              <AnswersChart answers={r().answers} />
            </Show>
          </Match>
        </Switch>
        <div class="transport">
          <div class="btn-group">
            <Button icon="record" info="Again, same stage" onClick={() => props.dispatch({ type: 'practice' })}>Again</Button>
            <Show when={r().kind === 'exercise'}>
              <Button icon="play" info="Listen to it" onClick={() => props.dispatch({ type: 'listen' })}>Listen</Button>
            </Show>
            <Button on info="Next — stage 2 if stage 1 is just passed, else the next step" onClick={() => props.dispatch({ type: 'next' })}>Next</Button>
            <Button info="Move on — count stage 1 as enough, or skip" onClick={() => props.dispatch({ type: 'skip' })}>Move on</Button>
          </div>
        </div>
      </section>
    </Show>
  );
}

/* ---- Progress -------------------------------------------------------------- */

export function ProgressView(props) {
  const p = () => props.vm().progress;
  const d = () => p() && p().detail;
  return (
    <Show when={p()}>
      <section class="screen progress-screen" aria-labelledby="progress-title">
        <header class="screen-head">
          <h1 id="progress-title" class="t-title">Progress</h1>
        </header>
        <div class="progress-layout">
          <ul class="rows" aria-label="Progress">
            <For each={p().rows}>{(row, i) => (
              <li>
                <button class="row" classList={{ on: i() === p().cursor && !!d() }}
                        onClick={() => props.dispatch({ type: 'progress', index: i() })}>
                  <span class="row-label">{row.label}</span>
                  <span class="row-value">{row.value}</span>
                </button>
              </li>
            )}</For>
          </ul>
          <div class="progress-detail">
            <Show when={d()} fallback={<p class="t-hint">Pick a row to see its chart.</p>}>
              <Switch>
                <Match when={d().kind === 'overview'}>
                  <h2 class="t-label">{d().title} · {d().percent}%</h2>
                  <p class="t-hint">{d().done} done · {d().half} half · of {d().count}</p>
                  <TimelineChart timeline={d().timeline} plotW={props.plot.w} plotH={props.plot.h} />
                </Match>
                <Match when={d().kind === 'drill'}>
                  <RoundsChart records={d().records} />
                  <Show when={d().answers && d().answers.length}>
                    <AnswersChart answers={d().answers} />
                  </Show>
                </Match>
                <Match when={d().kind === 'item'}>
                  <h2 class="t-label">{d().title} · {d().percent}%</h2>
                  <AttemptsChart history={d().history} />
                </Match>
              </Switch>
            </Show>
          </div>
        </div>
      </section>
    </Show>
  );
}

/* ---- Settings -------------------------------------------------------------- */

/* Move-only: where the Move sends its notes. A browser has its own piano. */
const MOVE_ONLY = new Set(['MIDI out', 'MIDI ch']);

export function SettingsView(props) {
  const s = () => props.vm().settings;
  const rows = () => s().rows.filter((r) => props.remote || !MOVE_ONLY.has(r.label));
  return (
    <section class="screen settings-screen" aria-labelledby="settings-title">
      <header class="screen-head"><h1 id="settings-title" class="t-title">Settings</h1></header>
      <ul class="rows settings-rows">
        <For each={rows()}>{(row) => (
          <li class="setting" classList={{ on: row.index === s().cursor }}
              onClick={() => props.dispatch({ type: 'selectSetting', index: row.index })}>
            <span class="row-label">{row.label}</span>
            <Button title={`Less ${row.label}`} ariaLabel={`Less ${row.label}`}
                    onClick={() => props.dispatch({ type: 'editSetting', index: row.index, delta: -1 })}>−</Button>
            <span class="pp-value setting-value">{row.value}</span>
            <Button title={`More ${row.label}`} ariaLabel={`More ${row.label}`}
                    onClick={() => props.dispatch({ type: 'editSetting', index: row.index, delta: 1 })}>+</Button>
          </li>
        )}</For>
      </ul>
      {props.extra}
    </section>
  );
}

/* ---- Info ------------------------------------------------------------------ */

export function InfoView(props) {
  const info = () => props.vm().info;
  return (
    <Show when={info()}>
      <section class="screen info-screen" aria-labelledby="info-title">
        <header class="screen-head"><h1 id="info-title" class="t-title">{info().title}</h1></header>
        <article class="info-text">
          <For each={info().paragraphs}>{(p) => (
            <Show when={p.text} fallback={<span class="info-gap" />}>
              <Show when={p.head} fallback={<p class="t-value">{p.text}</p>}>
                <h2 class="t-label">{p.text}</h2>
              </Show>
            </Show>
          )}</For>
        </article>
        <div class="transport"><Button onClick={() => props.dispatch({ type: 'info' })} info="Back to where you were">Close</Button></div>
      </section>
    </Show>
  );
}

/* ---- The keys -------------------------------------------------------------- */

export function KeysPanel(props) {
  const vm = () => props.vm();
  const range = createMemo(() => keyboardRange(vm(), { max: props.narrow() ? 2 : 4 }));
  const answers = () => (vm().quiz && vm().quiz.mode === 'ear'
    ? vm().quiz.options.map((o) => ({ label: o.label, key: o.short, struck: o.out })) : null);
  return (
    <section class="keys" aria-label="Keys">
      <div class="keys-switch segmented" role="radiogroup" aria-label="Play on">
        <Button on={props.surface() === 'piano'} info="A piano keyboard" onClick={() => props.setSurface('piano')}>Piano</Button>
        <Button on={props.surface() === 'pads'} info="The Move's pads, as the module plays them" onClick={() => props.setSurface('pads')}>Pads</Button>
      </div>
      <Show when={props.surface() === 'piano'} fallback={
        <PadGrid playable transpose={vm().key.transpose} rootPc={vm().key.rootPc}
                 intervals={MODES[vm().key.mode] || MODES.major} fifths={vm().key.fifths}
                 states={props.store.padStates()} answers={answers()} showNames
                 onNoteOn={(p, v) => props.store.noteOn(p, v)} onNoteOff={(p) => props.store.noteOff(p)}
                 onAnswer={(i) => props.dispatch({ type: 'answer', index: i })} label="The Move's pads" />
      }>
        <Keyboard playable lowest={range().lowest} octaves={range().octaves} fifths={vm().key.fifths}
                  states={props.store.keyStates()} height={props.narrow() ? 112 : 136}
                  onNoteOn={(p, v) => props.store.noteOn(p, v)} onNoteOff={(p) => props.store.noteOff(p)}
                  label="Piano keyboard" />
      </Show>
    </section>
  );
}
