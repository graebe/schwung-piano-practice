// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * remote.mjs — the Move's half of the module's page in Schwung's web manager
 * (move.local:7700 › Remote UI › Tool). Pure: the host is passed in.
 *
 * The page and ui.js meet only in the DSP (dsp/piano/src/remote.rs), which is a
 * mailbox and nothing more:
 *
 *   set('vm', json)    the picture: encodeViewModel(viewModel(S)), as JSON
 *   set('stale', '1')  "it changed" without the picture: moves the DSP's rev
 *   get('inbox')       `w` or `-` (is a page watching?), then one action a line
 *
 * TWO HOST FACTS SET THE PACE.
 *  - A read is a round trip that waits for the next audio block (~3ms, more
 *    than a frame). So the inbox is read on a slow clock: once a second when
 *    nobody is watching, five times a second when somebody is.
 *  - A write is fire-and-forget into a single-slot mailbox and is DROPPED when
 *    the slot is busy. The notes share it. So nothing is written on a tick that
 *    already wrote, and a write the host refused is simply tried again.
 *
 * WATCHING. The DSP counts a page as open while the manager keeps reading the
 * picture, which it does only when rev moves. So while watched, the picture is
 * sent when it changes (at most every PUBLISH_MIN_MS — the manager's own read
 * throttle) and at least every HEARTBEAT_MS, which keeps the DSP's three-second
 * watch alive. Nobody watching costs one inbox read a second and a `stale`
 * every couple of seconds — the nudge that lets a page whose watch lapsed
 * (a stalled WiFi link) pull again and so be seen again.
 *
 * WHAT COUNTS AS A CHANGE. Everything but the playhead's position: the page
 * carries `clock.beats` forward itself, so a picture that differs only there
 * waits for the heartbeat rather than going out four times a second.
 */
import { STATE_LIMIT } from './view_model.mjs';

export const POLL_IDLE_MS = 1000;
export const POLL_WATCHED_MS = 200;
export const PUBLISH_MIN_MS = 300;
export const HEARTBEAT_MS = 1000;
export const STALE_EVERY_MS = 2000;

/* What the DSP's inbox read says. Anything that is not an action is skipped:
 * a page cannot make ui.js throw. */
export function parseInbox(text) {
  if (typeof text !== 'string' || !text) return { watched: false, actions: [] };
  const lines = text.split('\n');
  const actions = [];
  for (let i = 1; i < lines.length; i++) {
    try {
      const a = JSON.parse(lines[i]);
      if (a && typeof a === 'object' && typeof a.type === 'string') actions.push(a);
    } catch (e) {
      /* not an action */
    }
  }
  return { watched: lines[0] === 'w', actions };
}

/* The picture as it is compared: every field, the clock without its beat. */
function signature(flat) {
  let clock = flat.clock;
  try {
    const c = JSON.parse(clock);
    if (c && typeof c === 'object') {
      delete c.beats;
      delete c.bar;
      delete c.beat;
      delete c.beatFlash;
      clock = JSON.stringify(c);
    }
  } catch (e) {
    /* compare it as it is */
  }
  return JSON.stringify({ ...flat, clock });
}

/*
 *   get(key) -> string | null    a param read (the host's host_module_get_param)
 *   set(key, val) -> boolean     a param write; false when the host refused it
 *   snapshot() -> flat object    encodeViewModel(viewModel(S))
 */
export function createRemote({ get, set, snapshot }) {
  let watched = false;
  let nextPoll = 0;
  let lastPublish = -Infinity;
  let lastStale = -Infinity;
  let sent = null;

  return {
    get watched() {
      return watched;
    },

    /* The page's actions since the last read, or none if a read is not due. */
    poll(t) {
      if (t < nextPoll) return [];
      const inbox = parseInbox(get('inbox'));
      watched = inbox.watched;
      nextPoll = t + (watched ? POLL_WATCHED_MS : POLL_IDLE_MS);
      return inbox.actions;
    },

    /* At most one write, never on a tick that already wrote one. True if it did. */
    publish(t, busy) {
      if (busy) return false;
      if (!watched) {
        if (t - lastStale < STALE_EVERY_MS) return false;
        if (!set('stale', '1')) return false;
        lastStale = t;
        return true;
      }
      const heartbeat = t - lastPublish >= HEARTBEAT_MS;
      if (!heartbeat && t - lastPublish < PUBLISH_MIN_MS) return false;
      const flat = snapshot();
      const sig = signature(flat);
      if (!heartbeat && sig === sent) return false;
      const json = JSON.stringify(flat);
      /* The manager drops a picture it cannot read whole; sending it would
       * only freeze the page on a larger copy of nothing. */
      if (json.length > STATE_LIMIT) {
        lastPublish = t;
        return false;
      }
      if (!set('vm', json)) return false;
      lastPublish = t;
      sent = sig;
      return true;
    },
  };
}
