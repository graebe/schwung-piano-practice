// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * staff.js -- the grand staff's geometry. Pure: no DOM, testable in node.
 *
 * A port of the plugin kit's GrandStaff (plugins/_shared/ui/src/GrandStaff.cpp)
 * from pixels to staff spaces, so the same arithmetic draws at any size.
 *
 * STEPS, NOT PITCHES. A note's place on a staff is its letter, counted in
 * letter steps up from C0: middle C is 28, E4 30, F5 38. Which letter a MIDI
 * pitch is written as is a question of spelling, and the module's engine
 * answers it (src/notation.mjs, spell): this file never spells a pitch itself.
 *
 *   treble   top line F5 (38), bottom line E4 (30)
 *   bass     top line A3 (26), bottom line G2 (18)
 *   between  seven spaces from the treble's top line to the bass's: E4's line,
 *            middle C's ledger and the space either side of it, so middle C
 *            has a place on each staff, one space apart
 *
 * BRAVURA BY SMuFL's RULES. The font's em is four staff spaces, and every
 * glyph's origin is where SMuFL puts it: a notehead's and an accidental's on
 * the line or space the note sits on, the G clef's on G4's line, the F clef's
 * on F3's. So a glyph is placed by the staff position it means, never by its
 * box. The font here is NI Notation, the subset of Bravura in web/fonts, and
 * its advance widths come from the font itself (notation-metrics.json, written
 * by scripts/subset-fonts.sh).
 */
import { spell, chordLabel } from '../../../src/notation.mjs';
import metrics from './notation-metrics.json' with { type: 'json' };

export const MIDDLE_C = 28;
export const TREBLE_TOP = 38;    // F5
export const TREBLE_BOTTOM = 30; // E4
export const BASS_TOP = 26;      // A3
export const BASS_BOTTOM = 18;   // G2
/* The clefs' own lines: G4 for the G clef, F3 for the F clef. */
export const G_CLEF_STEP = 32;
export const F_CLEF_STEP = 24;

/* From the treble's top line to the bass's, in spaces. */
export const STAFF_GAP = 7;
/* Bravura's em, in staff spaces. */
export const EM = 4;

/* The SMuFL code points this app draws: every one of them is in the subset,
 * and scripts/subset-fonts.sh lists the same set. */
export const GLYPH = {
  gClef: 0xe050,
  fClef: 0xe062,
  noteheadHalf: 0xe0a3,
  noteheadBlack: 0xe0a4,
  noteheadX: 0xe0a9,
  flat: 0xe260,
  natural: 0xe261,
  sharp: 0xe262,
  doubleSharp: 0xe263,
  doubleFlat: 0xe264,
  timeSig0: 0xe080,
};

/* The font family the stylesheet registers the subset under. */
export const NOTATION_FONT = 'NI Notation';

/** A code point as the one-character string an SVG <text> draws. */
export const char = (cp) => String.fromCodePoint(cp);

/** A glyph's advance width, in staff spaces, read from the font. */
export function advance(cp) {
  const units = metrics.advance[cp.toString(16).toUpperCase()];
  if (units === undefined) throw new Error(`U+${cp.toString(16).toUpperCase()} is not in NI Notation`);
  return (units / metrics.unitsPerEm) * EM;
}

/** The accidental for -2..2: double flat to double sharp, 0 a natural. */
export function accidentalGlyph(alteration) {
  switch (alteration) {
    case -2: return GLYPH.doubleFlat;
    case -1: return GLYPH.flat;
    case 1: return GLYPH.sharp;
    case 2: return GLYPH.doubleSharp;
    case 0: return GLYPH.natural;
    default: throw new Error(`no accidental for an alteration of ${alteration}`);
  }
}

/** A number as time-signature digits: 12 -> two glyphs. */
export function timeSigText(n) {
  return String(n).split('').map((d) => char(GLYPH.timeSig0 + Number(d))).join('');
}

/** Its width in spaces, for centring a numerator over its denominator. */
export function timeSigWidth(n) {
  return String(n).split('').reduce((w, d) => w + advance(GLYPH.timeSig0 + Number(d)), 0);
}

/* ----------------------------------------------------------- spelling -- */

/**
 * How a pitch is written under a key: its step and alteration, from the
 * engine's spelling. `fifths` -7..7, sharps positive.
 */
export function written(pitch, fifths = 0) {
  const s = spell(pitch, fifths);
  return { step: s.diatonic, alteration: s.alter, letter: s.letterIndex, label: s.label, name: s.name };
}

/** A note's name as a screen reader should say it: "F sharp 4". */
export function spokenName(pitch, fifths = 0) {
  const s = spell(pitch, fifths);
  const acc = s.alter === 1 ? ' sharp' : s.alter === -1 ? ' flat' : '';
  return `${s.letter}${acc} ${s.octave}`;
}

/**
 * What a group of notes is called under the notes: the chord symbol when the
 * exercise gives one, else the note names low to high (the engine's
 * chordLabel), a single note as its name.
 */
export function noteLabel(pitches, fifths = 0, symbol) {
  if (symbol) return symbol;
  return chordLabel(pitches, fifths);
}

/* ------------------------------------------------------------ staves -- */

/**
 * Which staff a note is written on: by the hand that plays it when the
 * exercise says ('r' treble, 'l' bass), otherwise middle C and up on the
 * treble and the rest on the bass, as the kit's GrandStaff does.
 */
export function staffOf(step, hand) {
  if (hand === 'r') return 'treble';
  if (hand === 'l') return 'bass';
  return step >= MIDDLE_C ? 'treble' : 'bass';
}

/** A step's height in spaces below the treble's top line, on its staff. */
export function spacesBelowTop(step, staff) {
  if (staff === 'treble') return (TREBLE_TOP - step) / 2;
  if (staff === 'bass') return STAFF_GAP + (BASS_TOP - step) / 2;
  throw new Error(`no staff called ${staff}`);
}

/** The steps of a staff's five lines, bottom to top. */
export function staffLines(staff) {
  const bottom = staff === 'treble' ? TREBLE_BOTTOM : BASS_BOTTOM;
  return [0, 1, 2, 3, 4].map((i) => bottom + 2 * i);
}

/**
 * The ledger lines a note needs between it and its staff, as steps, nearest
 * the staff first. A note in the space just outside a staff needs none.
 * Middle C on either staff takes one, on step 28.
 */
export function ledgerSteps(step, staff) {
  const top = staff === 'treble' ? TREBLE_TOP : BASS_TOP;
  const bottom = staff === 'treble' ? TREBLE_BOTTOM : BASS_BOTTOM;
  const out = [];
  for (let s = top + 2; s <= step; s += 2) out.push(s);
  for (let s = bottom - 2; s >= step; s -= 2) out.push(s);
  return out;
}

/* ----------------------------------------------------- key signatures -- */

/* The order the accidentals of a signature are written in, as letters (0 C to
 * 6 B), and the treble steps they sit on; the bass writes each two octaves
 * (14 steps) lower. */
export const SHARP_LETTERS = [3, 0, 4, 1, 5, 2, 6];
export const SHARP_STEPS = [38, 35, 39, 36, 33, 37, 34];
export const FLAT_LETTERS = [6, 2, 5, 1, 4, 0, 3];
export const FLAT_STEPS = [34, 37, 33, 36, 32, 35, 31];

const clampFifths = (f) => Math.max(-7, Math.min(7, Math.trunc(f) || 0));

/* The gap between two accidentals of a signature, in spaces. */
export const SIGNATURE_GAP = 0.12;

/** How far one accidental of a signature is from the next: its own width
 * and the gap. */
export const signatureStep = (glyph) => advance(glyph) + SIGNATURE_GAP;

/**
 * A signature's accidentals on a staff, in writing order:
 * [{ step, glyph, letter, x }], `x` in spaces from the signature's start.
 * `fifths` -7..7.
 */
export function keySignature(fifths, staff) {
  const f = clampFifths(fifths);
  const sharp = f > 0;
  const steps = sharp ? SHARP_STEPS : FLAT_STEPS;
  const letters = sharp ? SHARP_LETTERS : FLAT_LETTERS;
  const glyph = sharp ? GLYPH.sharp : GLYPH.flat;
  const drop = staff === 'bass' ? 14 : 0;
  const out = [];
  for (let i = 0; i < Math.abs(f); i++)
    out.push({ step: steps[i] - drop, glyph, letter: letters[i], x: i * signatureStep(glyph) });
  return out;
}

/** A signature's width in spaces: where whatever follows it may start. */
export function signatureWidth(marks) {
  if (!marks.length) return 0;
  const last = marks[marks.length - 1];
  return last.x + advance(last.glyph);
}

/**
 * The naturals that cancel a signature when the key changes to C: the old
 * signature's places, each a natural. Any other change writes the new
 * signature on its own, as most modern engraving does.
 */
export function keyChangeGlyphs(from, to, staff) {
  if (clampFifths(to) !== 0) return keySignature(to, staff);
  return keySignature(from, staff)
    .map((k, i) => ({ ...k, glyph: GLYPH.natural, x: i * signatureStep(GLYPH.natural) }));
}

/** What the signature does to a letter (0 C to 6 B): -1, 0 or 1. */
export function signatureAlteration(fifths, letter) {
  const f = clampFifths(fifths);
  const letters = f > 0 ? SHARP_LETTERS : FLAT_LETTERS;
  for (let i = 0; i < Math.abs(f); i++) if (letters[i] === letter) return f > 0 ? 1 : -1;
  return 0;
}

/**
 * The accidental to draw beside a note, or null: drawn whenever the note's
 * alteration differs from the signature's for its letter, so a natural
 * cancels one. Each note is judged on its own, against the signature only --
 * the kit's rule, and the right one for a reading trainer, where an accidental
 * remembered from earlier in the bar is one more thing to get wrong.
 */
export function accidentalFor(alteration, letter, fifths) {
  return alteration === signatureAlteration(fifths, letter) ? null : accidentalGlyph(alteration);
}

/* ------------------------------------------------------------ chords -- */

/**
 * Which heads of a chord move a head's width to the right: the upper of two
 * notes a step apart, as an engraver sets a second. `steps` on one staff;
 * returns a boolean per input, in input order.
 */
export function secondShifts(steps) {
  const order = steps.map((s, i) => [s, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(steps.length).fill(false);
  for (let k = 1; k < order.length; k++) {
    const [s, i] = order[k];
    const [p, j] = order[k - 1];
    if (s - p === 1 && !out[j]) out[i] = true;
  }
  return out;
}

/**
 * Columns for a chord's accidentals, so they do not collide: from the top
 * down, each takes the nearest column (0 against the heads) with no
 * accidental within a sixth (5 steps) of it. `steps` of the notes that carry
 * one; returns a column per input, in input order.
 */
export function accidentalColumns(steps) {
  const order = steps.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]);
  const placed = [];
  const out = new Array(steps.length).fill(0);
  for (const [s, i] of order) {
    let col = 0;
    while (placed.some((p) => p.col === col && Math.abs(p.step - s) < 6)) col++;
    placed.push({ step: s, col });
    out[i] = col;
  }
  return out;
}

/* ------------------------------------------------------------ layout -- */

/*
 * The fixed part at the left, in spaces, ported from the kit's pixel
 * constants at its 8px space: the clef 0.5 in, the signature from 3.75 (here
 * 4: the kit's left a G clef and a first flat touching), then the time
 * signature and a space. The kit stepped a signature 0.875 spaces an
 * accidental, less than a sharp is wide; here each steps by its own width
 * (signatureStep), so sharps do not touch.
 */
export const CLEF_X = 0.5;
export const SIGNATURE_X = 4;
export const LEDGER_OVER = 0.375;
export const ACCIDENTAL_GAP = 0.3;

/** Where the time signature starts and the gutter ends, in spaces. */
export function gutter(fifths, timeSig) {
  const sigEnd = SIGNATURE_X + signatureWidth(keySignature(fifths, 'treble'));
  if (!timeSig) return { timeX: null, end: sigEnd + 1 };
  const w = Math.max(timeSigWidth(timeSig[0]), timeSigWidth(timeSig[1]));
  const timeX = sigEnd + 0.5;
  return { timeX, timeWidth: w, end: timeX + w + 1.5 };
}

/**
 * The vertical layout of the whole system for a staff space `space` (px):
 * room above the treble for four ledger lines, room below the bass for three,
 * and a lane for the names under that. Every y is an integer, so a 1px line
 * drawn at y + 0.5 is one device pixel at 1x and two at 2x.
 */
export function systemLayout(space, { above = 4.5, below = 3.5, names = 18 } = {}) {
  const top = Math.round(above * space);
  const y = (step, staff) => Math.round(top + spacesBelowTop(step, staff) * space);
  const bassBottom = y(BASS_BOTTOM, 'bass');
  const nameY = Math.round(bassBottom + below * space);
  return {
    space,
    top,
    y,
    trebleTop: top,
    bassBottom,
    nameY,
    height: nameY + (names > 0 ? names : 0),
  };
}
