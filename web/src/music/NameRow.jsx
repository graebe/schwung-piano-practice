// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * NameRow — names in a row that moves on one place per right answer: the
 * staff's scroll, for drills that read a letter or a chord symbol instead of
 * notation.
 *
 * Laid out in ch, the advance of the monospace face, so a name's width is its
 * length and every place is known without measuring. A name keeps the place it
 * arrived at; the row slides under a fixed window by one CSS transform, eased
 * as the staff eases.
 *
 * Props:
 *   items    [{ index, name }], head first; `index` counts from the start of
 *            the round, so a name keeps its place as the row moves on
 *   solved   the head has been played: it lights, and the row moves on to the
 *            next one at once, while the session still holds the old head
 *   label    its accessible name
 */
import { For, createMemo } from 'solid-js';

/* Space between names, in ch. */
export const GAP_CH = 3;

/*
 * Places, in ch from the start of the round. Kept across updates: a name's
 * place depends only on the names before it, and those never change.
 */
export function createPlaces() {
  const at = new Map();
  let last = null;
  return (items) => {
    for (const it of items) {
      if (at.has(it.index)) continue;
      const prev = last && at.get(last.index);
      at.set(it.index, prev === undefined || last === null ? 0 : prev + last.name.length + GAP_CH);
      last = it;
    }
    /* Forget what has long left the window. */
    const head = items.length ? items[0].index : 0;
    for (const k of at.keys()) if (k < head - 2) at.delete(k);
    return at;
  };
}

export function NameRow(props) {
  let place = createPlaces();
  const cache = new Map();
  /* The previous head, kept while it slides out to the left. */
  let gone = null;

  const shown = createMemo((prev) => {
    const items = props.items ?? [];
    /* A new round: the same indices again, with other names behind them. */
    const fresh = items.some((it) => cache.has(it.index) && cache.get(it.index).name !== it.name)
      || (prev && prev.length && items.length && items[0].index < prev[0].index);
    if (fresh) {
      place = createPlaces();
      cache.clear();
      gone = null;
    } else if (prev && prev.length && items.length && prev[0].index === items[0].index - 1) {
      gone = prev[0];
    }
    /* One object per index, so <For> keeps a name's node as the row moves. */
    const list = items.map((it) => {
      if (!cache.has(it.index)) cache.set(it.index, it);
      return cache.get(it.index);
    });
    for (const k of cache.keys()) if (items.length && k < items[0].index) cache.delete(k);
    return list;
  });
  const places = createMemo(() => place(gone ? [gone, ...shown()] : shown()));
  const head = () => (shown()[0] ? shown()[0].index : 0);
  const target = () => {
    const list = shown();
    if (!list.length) return 0;
    const at = places();
    const next = props.solved && list[1] ? list[1].index : list[0].index;
    return at.get(next) ?? 0;
  };
  const all = () => (gone && gone.index === head() - 1 ? [gone, ...shown()] : shown());

  return (
    <div class="name-row" role="img" aria-label={`${props.label ?? 'Names'}: ${shown().map((n) => n.name).join(', ')}`}>
      <div class="name-row-track t-readout" style={{ transform: `translateX(-${target()}ch)` }}>
        <For each={all()}>{(it) => (
          <span class="name-row-name"
                classList={{
                  head: it.index === head(),
                  solved: it.index === head() && !!props.solved,
                  gone: it.index < head(),
                }}
                data-index={it.index}
                style={{ left: `${places().get(it.index) ?? 0}ch` }}>
            {it.name}
          </span>
        )}</For>
      </div>
    </div>
  );
}
