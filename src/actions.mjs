// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * actions.mjs — what the page can ask of a session, as data. Pure.
 *
 * The page never calls the session directly: it dispatches one of these, and
 * a backend carries it out. The local backend applies it here, to the session
 * running beside the page; the Move's backend will send the same object to the
 * device, where ui.js applies it with this same function. So an action means
 * one thing wherever the session runs.
 *
 *   { type: 'noteOn', pitch, vel }     a key, a pad, a MIDI note
 *   { type: 'noteOff', pitch }
 *   { type: 'select', index }          point at a row of the list
 *   { type: 'open' }                   open it / arm it / confirm
 *   { type: 'back' }                   up a level; restart a run; retry a result
 *   { type: 'move', delta }            the jog: the cursor, the stage, the option
 *   { type: 'options' }                Shift + jog-click: the row's options in
 *                                      the list, settings on a piece, skip on
 *                                      a result
 *   { type: 'sheet' }                  the highlighted row's options, from the list
 *   { type: 'sheetPick', index }       run one of them
 *   { type: 'cardPick', index }        answer the welcome's question
 *   { type: 'mapGo', index }           a place of the map: walk there, or go
 *                                      in when the avatar is already there
 *   { type: 'homeGo', index }          a circle of home: select it and open it
 *   { type: 'skip' }                   a scene of the Learning Path: to its end
 *   { type: 'settings' }               the Settings page, from the list
 *   { type: 'listen' }                 Play: hear it; again to pause
 *   { type: 'practice' }               Record: play it; again to pause
 *   { type: 'info' }                   Menu: what this is, and its words
 *   { type: 'hint' }                   a quiz's help ladder (Record in a quiz)
 *   { type: 'hear' }                   a quiz's prompt again (Play in a quiz)
 *   { type: 'answer', index }          a multiple-choice answer
 *   { type: 'next' } / { type: 'skip' } / { type: 'retry' }   on a result
 *   { type: 'stage', stage }           1 or 2, on the ready screen
 *   { type: 'level', index }           another level of the armed piece, on
 *                                      the ready screen, from bar 1
 *   { type: 'scrubTo', beat }          the playhead, while parked
 *   { type: 'tempo', delta }
 *   { type: 'editSetting', index, delta }
 *   { type: 'selectSetting', index }
 *   { type: 'editRow', row, delta }    a row of the settings page by its place
 *   { type: 'settingRow', row }        point at it; an action row also runs
 *   { type: 'progress', index }        open a Progress row's chart
 *
 * Returns what the session answered, for a note: the judgement or the quiz's
 * verdict, which a renderer flashes; otherwise null.
 */

import { MENU, READY, RESULT_VIEW, PROGRESS_VIEW, PROGRESS_DETAIL, SETTINGS } from './session.mjs';
import { settingIndex } from './settings_def.mjs';
import { beatsPerBar } from './chart.mjs';

/* The knob's scrub resolution (ui.js / session.mjs: SCRUB_UNITS_PER_BAR). */
const SCRUB_UNITS_PER_BAR = 36;

export const ACTIONS = [
  'noteOn', 'noteOff', 'select', 'open', 'back', 'move', 'options', 'sheet', 'sheetPick', 'cardPick', 'mapGo',
  'homeGo', 'skip', 'settings', 'listen', 'practice', 'info', 'hint', 'hear', 'answer', 'next', 'skip', 'retry', 'stage', 'level',
  'scrubTo', 'tempo', 'editSetting', 'selectSetting', 'editRow', 'settingRow', 'progress',
];

const MIDI = (n) => Number.isInteger(n) && n >= 0 && n <= 127;

export function applyAction(S, a) {
  if (!a || typeof a.type !== 'string') return null;
  switch (a.type) {
    case 'noteOn':
      return MIDI(a.pitch) ? S.play(a.pitch, MIDI(a.vel) && a.vel > 0 ? a.vel : 100) : null;
    case 'noteOff':
      if (MIDI(a.pitch)) S.release(a.pitch);
      return null;
    case 'select':
      S.selectRow(a.index | 0);
      return null;
    case 'open':
      S.activate(false);
      return null;
    case 'back':
      S.back();
      return null;
    case 'move':
      if (a.delta) S.moveSelection(a.delta > 0 ? 1 : -1);
      return null;
    case 'options':
      S.activate(true);
      return null;
    case 'sheet':
      if (S.view === MENU) S.openSheet();
      return null;
    case 'sheetPick':
      S.pickSheet(a.index | 0);
      return null;
    case 'cardPick':
      S.pickCard(a.index | 0);
      return null;
    case 'mapGo':
      S.mapPick(a.index | 0);
      return null;
    case 'homeGo':
      S.homePick(a.index | 0);
      return null;
    case 'skip':
      S.skipScenes();
      return null;
    case 'settings':
      /* The Settings page, over the list; on a result the same Move gesture
       * means "skip", which is its own action here. */
      if (S.view === MENU) S.openSettingsPage();
      return null;
    case 'listen':
    case 'hear':
      S.playButton();
      return null;
    case 'practice':
    case 'hint':
      S.recordButton();
      return null;
    case 'info':
      S.menuButton();
      return null;
    case 'answer':
      return S.answer(a.index | 0);
    case 'next':
      if (S.view === RESULT_VIEW) S.activate(false);
      return null;
    case 'skip':
      if (S.view === RESULT_VIEW) S.activate(true);
      return null;
    case 'retry':
      if (S.view === RESULT_VIEW) S.back();
      return null;
    case 'stage':
      if (S.view === READY && (a.stage === 1 || a.stage === 2) && a.stage !== S.stage) {
        S.moveSelection(a.stage === 2 ? 1 : -1);
      }
      return null;
    case 'level':
      if (S.view === READY) S.armLevel(a.index | 0);
      return null;
    case 'scrubTo': {
      if (!S.chart || !S.scrubAllowed() || typeof a.beat !== 'number') return null;
      const perBar = beatsPerBar(S.chart);
      const units = Math.round(((a.beat - Math.max(0, S.songBeats)) * SCRUB_UNITS_PER_BAR) / perBar);
      if (units) S.scrubBy(units);
      return null;
    }
    case 'tempo':
      if (a.delta) S.editSetting(settingIndex('bpm'), a.delta);
      return null;
    case 'editSetting':
      if (a.delta) S.editSetting(a.index | 0, a.delta);
      return null;
    case 'selectSetting':
      S.selectSetting(a.index | 0);
      S.dirty = true;
      return null;
    case 'editRow':
      if (S.view === SETTINGS && a.delta) S.editRow(a.row | 0, a.delta);
      return null;
    case 'settingRow': {
      if (S.view !== SETTINGS) return null;
      S.selectSettingRow(a.row | 0);
      const row = S.settingsRows()[a.row | 0];
      if (row && row.act) S.activate(false);
      S.dirty = true;
      return null;
    }
    case 'progress':
      if (S.view !== PROGRESS_VIEW && S.view !== PROGRESS_DETAIL) return null;
      S.selectProgress(a.index | 0);
      if (S.view === PROGRESS_VIEW) S.activate(false);
      return null;
    default:
      return null;
  }
}
