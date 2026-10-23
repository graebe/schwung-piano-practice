// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * fake_host.mjs — a session's fx, in memory: a clock the test moves, the real
 * exercise files, settings/stats/progress in a Map, and a log of everything
 * the session asked the host to do.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createSession } from '../../src/session.mjs';
import { TIP_KEYS, PLACEMENT } from '../../src/tips.mjs';

const SRC = new URL('../../src/', import.meta.url).pathname;
export const QUIET = { version: 7, autoInfo: false, quizSounds: false, roundSize: 10 };
/* A learner who has been welcomed and seen every tip: what most tests want,
 * so a card does not sit over the screen they are about. `progress: null`
 * is a first launch. */
export const WELCOMED = { tips: TIP_KEYS.concat([PLACEMENT]) };

export function fakeHost({ settings = QUIET, progress = WELCOMED, opts = {} } = {}) {
  let ms = 1000;
  const files = new Map();
  if (settings) files.set('settings.json', JSON.stringify(settings));
  if (progress) files.set('progress.json', JSON.stringify(progress));
  const log = [];
  const sounding = new Map();
  const fx = {
    now: () => ms,
    wallNow: () => Date.UTC(2026, 9, 9) + ms,
    strike(pitch, vel) {
      log.push(['strike', pitch, vel]);
      sounding.set(pitch, (sounding.get(pitch) || 0) + 1);
    },
    release(pitch) {
      log.push(['release', pitch]);
      sounding.delete(pitch);
    },
    silence(held) {
      log.push(['silence', held.slice()]);
      sounding.clear();
    },
    announce: (text) => log.push(['say', text]),
    readText(name) {
      if (files.has(name)) return files.get(name);
      const path = SRC + name;
      return name.startsWith('exercises/') && existsSync(path) ? readFileSync(path, 'utf8') : null;
    },
    writeText(name, text) {
      files.set(name, text);
      log.push(['write', name]);
      return true;
    },
    exit: () => log.push(['exit']),
    settingChanged: (key) => log.push(['changed', key]),
    reveal: (pitches, ms2) => log.push(['reveal', pitches.slice(), ms2]),
  };
  const session = createSession(fx, opts);
  return {
    session,
    fx,
    files,
    log,
    sounding,
    get ms() { return ms; },
    /* Run the session's clock forward, a frame at a time. */
    run(duration, step = 10) {
      for (let t = 0; t < duration; t += step) {
        ms += step;
        session.tick(ms);
      }
    },
    said: () => log.filter((e) => e[0] === 'say').map((e) => e[1]),
  };
}

/* Walk the list by the labels on screen, as a person would. */
export function openPath(session, labels) {
  for (const label of labels) {
    const top = session.nav[session.nav.length - 1];
    const index = top.node.children.findIndex((r) => r.label === label);
    if (index < 0) throw new Error(`no row "${label}" in ${top.node.label}`);
    session.selectRow(index);
    session.activate(false);
  }
}

/*
 * Settings, as a person reaches it: the page (from the list, as the web
 * page's top bar does), and for a group, its Advanced row and the group.
 */
export function openSettings(session, group = 'main') {
  session.openSettingsPage();
  if (group === 'main') return;
  session.selectSettingRow(session.settingsRows().findIndex((r) => r.act === 'advanced'));
  session.activate(false);
  const top = session.nav[session.nav.length - 1];
  const index = top.node.children.findIndex((r) => r.settingsGroup === group);
  if (index < 0) throw new Error(`no group "${group}" in Advanced`);
  session.selectRow(index);
  session.activate(false);
}
