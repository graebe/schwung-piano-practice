// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * verdict.mjs — what a judge answers about what was played. Pure.
 *
 *   correct     the whole answer is down
 *   wrong       something that is not in the answer was played
 *   incomplete  part of the answer is down — not yet a mistake
 *
 * Shared by every subject's judge (chords, scales, progressions), so a round
 * reads one vocabulary whatever it asks.
 */

export const CORRECT = 'correct';
export const WRONG = 'wrong';
export const INCOMPLETE = 'incomplete';
