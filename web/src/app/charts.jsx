// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * charts.jsx — the result and progress charts.
 *
 * Small, one series each, in uv-deep: the one data colour that passes the
 * dataviz checks on Ultraviolet's panel (uv itself reads as grey there). Where
 * the Move draws a quiz drill's rate as a line and its error rate as bars on
 * one plot, two measures on two scales, the page draws two charts on one time
 * axis instead — a chart has one y-scale.
 *
 * Every chart: thin marks (2px lines, 8px markers), a recessive grid, a hover
 * read-out per mark, a legend where two kinds of mark share it, and the
 * numbers as a table for anyone who would rather read them.
 */
import { For, Show, createSignal } from 'solid-js';

const W = 560;
const PAD = { l: 36, r: 12, t: 12, b: 22 };

/* Gridlines at nothing, half and the top. */
const thirds = (max) => [0, max / 2, max];

function frame(h) {
  return { w: W, h, iw: W - PAD.l - PAD.r, ih: h - PAD.t - PAD.b };
}

function when(t) {
  if (!t) return '';
  return new Date(t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function Tip(props) {
  return (
    <Show when={props.tip}>
      {(tip) => (
        <div class="chart-tip t-hint" style={{ left: `${(tip().x / W) * 100}%`, top: `${tip().y}px` }}>
          {tip().text}
        </div>
      )}
    </Show>
  );
}

function YAxis(props) {
  const f = frame(props.h);
  return (
    <For each={props.ticks}>{(v) => {
      const y = PAD.t + f.ih - (v / props.max) * f.ih;
      return (
        <g class="chart-grid">
          <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} />
          <text x={PAD.l - 6} y={y + 3} text-anchor="end">{props.format ? props.format(v) : v}</text>
        </g>
      );
    }}</For>
  );
}

function DataTable(props) {
  return (
    <details class="chart-table t-hint">
      <summary>{props.summary || 'The numbers'}</summary>
      <table>
        <thead><tr><For each={props.head}>{(h) => <th scope="col">{h}</th>}</For></tr></thead>
        <tbody><For each={props.rows}>{(r) => <tr><For each={r}>{(c) => <td>{c}</td>}</For></tr>}</For></tbody>
      </table>
    </details>
  );
}

/*
 * An exercise's attempts, on a fixed 0-100% scale so it reads the same on
 * every visit: hollow points stage 1 (the pads lit), solid points stage 2
 * (reading alone), the dashed line the 90% a stage needs.
 */
export function AttemptsChart(props) {
  const h = 170;
  const f = frame(h);
  const [tip, setTip] = createSignal(null);
  const rows = () => props.history || [];
  const x = (i) => PAD.l + (rows().length <= 1 ? f.iw / 2 : (i / (rows().length - 1)) * f.iw);
  const y = (pct) => PAD.t + f.ih - (pct / 100) * f.ih;
  const path = () => rows().map((r, i) => `${i ? 'L' : 'M'}${x(i)},${y(r[1])}`).join(' ');
  return (
    <figure class="chart">
      <figcaption class="t-label">Every attempt</figcaption>
      <div class="chart-legend t-hint" aria-hidden="true">
        <span><svg width="10" height="10"><circle cx="5" cy="5" r="3.5" class="mark-hollow" /></svg> Guided, pads lit</span>
        <span><svg width="10" height="10"><circle cx="5" cy="5" r="4" class="mark-solid" /></svg> Solo, reading</span>
        <span><svg width="16" height="10"><line x1="0" x2="16" y1="5" y2="5" class="chart-pass" /></svg> 90% passes</span>
      </div>
      <div class="chart-plot">
        <svg viewBox={`0 0 ${W} ${h}`} role="img"
             aria-label={`${rows().length} attempts, latest ${rows().length ? rows().at(-1)[1] : 0}%`}
             onPointerLeave={() => setTip(null)}>
          <YAxis h={h} max={100} ticks={thirds(100)} format={(v) => `${v}%`} />
          <line class="chart-pass" x1={PAD.l} x2={W - PAD.r} y1={y(90)} y2={y(90)} />
          <path class="chart-line" d={path()} />
          <For each={rows()}>{(r, i) => (
            <g>
              <circle cx={x(i())} cy={y(r[1])} r={r[2] === 2 ? 4 : 3.5}
                      class={r[2] === 2 ? 'mark-solid' : 'mark-hollow'} />
              <circle cx={x(i())} cy={y(r[1])} r="12" class="chart-hit"
                      onPointerEnter={() => setTip({ x: x(i()), y: y(r[1]) - 34,
                        text: `${r[1]}% · stage ${r[2]}${r[3] ? ` · ${r[3]} bpm` : ''}${r[0] ? ` · ${when(r[0])}` : ''}` })} />
            </g>
          )}</For>
        </svg>
        <Tip tip={tip()} />
      </div>
      <DataTable head={['#', 'Score', 'Stage', 'Tempo', 'Date']}
                 rows={rows().map((r, i) => [i + 1, `${r[1]}%`, r[2], r[3] ? `${r[3]} bpm` : '', when(r[0])])} />
    </figure>
  );
}

/*
 * A quiz drill's rounds: correct answers a minute, and, on its own 0-100%
 * scale underneath, how many attempts were right — what Progress scores a
 * round by, with the 90% a pass needs dashed across it.
 */
export function RoundsChart(props) {
  const records = () => props.records || [];
  const rate = (r) => (r.ms > 0 ? (r.n * 60000) / r.ms : 0);
  const ok = (r) => (r.n + r.w > 0 ? r.n / (r.n + r.w) : 0);
  const max = () => Math.max(10, Math.ceil(Math.max(0, ...records().map(rate)) / 10) * 10);
  const [tip, setTip] = createSignal(null);
  const hr = 140;
  const he = 90;
  const fr = frame(hr);
  const fe = frame(he);
  const x = (i) => PAD.l + (records().length <= 1 ? fr.iw / 2 : (i / (records().length - 1)) * fr.iw);
  const yr = (v) => PAD.t + fr.ih - (v / max()) * fr.ih;
  const ye = (v) => PAD.t + fe.ih - Math.min(1, v) * fe.ih;
  const barW = () => Math.max(3, Math.min(14, fr.iw / Math.max(1, records().length) - 2));
  const line = () => records().map((r, i) => `${i ? 'L' : 'M'}${x(i)},${yr(rate(r))}`).join(' ');
  const label = (r) => `${Math.round(rate(r))}/min · ${Math.round(ok(r) * 100)}% right${r.h ? ` · ${r.h} hint${r.h > 1 ? 's' : ''}` : ''} · ${when(r.t)}`;
  return (
    <figure class="chart">
      <figcaption class="t-label">Correct a minute</figcaption>
      <div class="chart-plot">
        <svg viewBox={`0 0 ${W} ${hr}`} role="img" aria-label={`${records().length} rounds, correct answers a minute`}
             onPointerLeave={() => setTip(null)}>
          <YAxis h={hr} max={max()} ticks={thirds(max())} />
          <path class="chart-line" d={line()} />
          <For each={records()}>{(r, i) => (
            <g>
              <circle cx={x(i())} cy={yr(rate(r))} r="4" class="mark-solid" />
              <circle cx={x(i())} cy={yr(rate(r))} r="12" class="chart-hit"
                      onPointerEnter={() => setTip({ x: x(i()), y: yr(rate(r)) - 34, text: label(r) })} />
            </g>
          )}</For>
        </svg>
        <Tip tip={tip()} />
      </div>
      <figcaption class="t-label chart-second">Right, of all attempts</figcaption>
      <div class="chart-plot">
        <svg viewBox={`0 0 ${W} ${he}`} role="img"
             aria-label={`share right per round, latest ${records().length ? Math.round(ok(records().at(-1)) * 100) : 0}%`}>
          <YAxis h={he} max={1} ticks={thirds(1)} format={(v) => `${Math.round(v * 100)}%`} />
          <line class="chart-pass" x1={PAD.l} x2={W - PAD.r} y1={ye(0.9)} y2={ye(0.9)} />
          <For each={records()}>{(r, i) => {
            const top = ye(ok(r));
            const base = PAD.t + fe.ih;
            return (
              <rect class="chart-bar" x={x(i()) - barW() / 2} width={barW()} y={top}
                    height={Math.max(0, base - top)} rx={Math.min(2, barW() / 2)}>
                <title>{label(r)}</title>
              </rect>
            );
          }}</For>
        </svg>
      </div>
      <DataTable head={['#', 'Correct', 'Time', 'A minute', 'Right', 'Hints', 'Date']}
                 rows={records().map((r, i) => [i + 1, r.n, `${Math.round(r.ms / 1000)}s`, Math.round(rate(r)),
                   `${Math.round(ok(r) * 100)}%`, r.h || 0, when(r.t)])} />
    </figure>
  );
}

/*
 * Each answer of a drill: a bar of how often it was right first time over
 * every round (the track is 100%), and a mark where this round put it — so
 * the answers you confuse stand out from the ones you have. Without a round
 * (Progress), the bars alone.
 *
 * answers: [{ label, allAsked, allRight, asked?, right? }]
 */
export function AnswersChart(props) {
  const rows = () => props.answers || [];
  const rowH = 26;
  const nameW = 130;
  const scoreW = 120;
  const h = () => rows().length * rowH + 8;
  const x0 = PAD.l + nameW - PAD.l;
  const bw = W - x0 - scoreW;
  const pct = (right, asked) => (asked > 0 ? right / asked : 0);
  const round = (r) => r.asked !== undefined && r.asked > 0;
  return (
    <figure class="chart">
      <figcaption class="t-label">Each answer, right first time</figcaption>
      <div class="chart-legend t-hint" aria-hidden="true">
        <span><svg width="16" height="10"><rect width="16" height="10" rx="2" class="chart-bar" /></svg> all rounds</span>
        <Show when={rows().some(round)}>
          <span><svg width="10" height="10"><circle cx="5" cy="5" r="4" class="mark-hollow" /></svg> this round</span>
        </Show>
      </div>
      <div class="chart-plot">
        <svg viewBox={`0 0 ${W} ${h()}`} role="img"
             aria-label={`${rows().length} answers, right first time`}>
          <For each={rows()}>{(r, i) => {
            const y = 4 + i() * rowH;
            const all = pct(r.allRight, r.allAsked);
            return (
              <g>
                <text class="chart-name" x={x0 - 8} y={y + rowH / 2 + 1} text-anchor="end">{r.label}</text>
                <rect class="chart-track" x={x0} y={y + 5} width={bw} height={rowH - 10} rx="2" />
                <rect class="chart-bar" x={x0} y={y + 5} width={Math.max(0, all * bw)} height={rowH - 10} rx="2">
                  <title>{`${r.label}: ${Math.round(all * 100)}% over ${r.allAsked}`}</title>
                </rect>
                <Show when={round(r)}>
                  <circle class="mark-hollow" cx={x0 + pct(r.right, r.asked) * bw} cy={y + rowH / 2} r="5" />
                </Show>
                <text class="chart-name" x={W - 4} y={y + rowH / 2 + 1} text-anchor="end">
                  {round(r) ? `${r.right}/${r.asked} · ` : ''}{Math.round(all * 100)}%
                </text>
              </g>
            );
          }}</For>
        </svg>
      </div>
      <DataTable head={['Answer', 'This round', 'All rounds', 'Right']}
                 rows={rows().map((r) => [r.label, round(r) ? `${r.right} of ${r.asked}` : '',
                   `${r.allRight} of ${r.allAsked}`, `${Math.round(pct(r.allRight, r.allAsked) * 100)}%`])} />
    </figure>
  );
}

/*
 * The long view: every stage passed, a step up at each pass along real time —
 * flat stretches are time off, steep ones where it clicked. The session lays
 * the points out on the plot it is given (passTimeline); this draws them.
 */
export function TimelineChart(props) {
  const h = 160;
  const f = frame(h);
  const pts = () => (props.timeline && props.timeline.points) || [];
  const px = (p) => PAD.l + (p.x / Math.max(1, props.plotW - 1)) * f.iw;
  const py = (p) => PAD.t + (p.y / Math.max(1, props.plotH - 1)) * f.ih;
  const steps = () => {
    const p = pts();
    if (!p.length) return '';
    let d = `M${PAD.l},${PAD.t + f.ih}`;
    for (const q of p) d += ` H${px(q)} V${py(q)}`;
    return d + ` H${W - PAD.r}`;
  };
  return (
    <figure class="chart">
      <figcaption class="t-label">Stages passed over time</figcaption>
      <Show when={pts().length} fallback={<p class="t-hint chart-empty">Nothing passed yet — every stage you pass adds a step here.</p>}>
        <div class="chart-plot">
          <svg viewBox={`0 0 ${W} ${h}`} role="img" aria-label={`${props.timeline.total} stages passed`}>
            <YAxis h={h} max={props.timeline.total} ticks={[0, props.timeline.total]} />
            <path class="chart-line" d={steps()} />
          </svg>
        </div>
      </Show>
    </figure>
  );
}
