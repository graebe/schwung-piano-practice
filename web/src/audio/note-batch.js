// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * note-batch.js — strikes and releases, gathered into one `n` list.
 *
 * The device's UI sends the piano one parameter write per tick carrying every
 * note of that tick ("60:100,64:100,67:100"), because its parameter channel
 * is a single-slot mailbox. The browser has no such mailbox, but sending the
 * same list keeps the two hosts on one protocol and lands a chord in one audio
 * quantum, so its notes start together rather than a quantum apart.
 *
 * Pure: no Web Audio, no timers. The caller says how to schedule a flush.
 */

/** One `pitch:velocity` entry, or null if the pitch is not a MIDI note. A
 *  missing or zero strike velocity is 100, as the device's UI sends it. */
export function strikeEntry(pitch, vel) {
  if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) return null;
  const v = Math.round(Number(vel) || 100);
  return pitch + ':' + Math.min(127, Math.max(1, v));
}

export function releaseEntry(pitch) {
  if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) return null;
  return pitch + ':0';
}

/**
 * A batch of entries in arrival order. `onPending` runs when the batch goes
 * from empty to non-empty — the moment to schedule a flush — and not again
 * until it has been emptied by `take` or `clear`.
 */
export function createNoteBatch(onPending) {
  const entries = [];
  const add = (entry) => {
    if (entry === null) return false;
    entries.push(entry);
    if (entries.length === 1) onPending();
    return true;
  };
  return {
    strike: (pitch, vel) => add(strikeEntry(pitch, vel)),
    release: (pitch) => add(releaseEntry(pitch)),
    /** Drop everything pending — a panic does not play the notes before it. */
    clear() {
      entries.length = 0;
    },
    /** The pending list as the device's `n` value, emptied; null if none. */
    take() {
      if (entries.length === 0) return null;
      const list = entries.join(',');
      entries.length = 0;
      return list;
    },
    get size() {
      return entries.length;
    },
  };
}
