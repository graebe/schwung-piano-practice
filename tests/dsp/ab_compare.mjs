/*
 * Compare two raw int16 streams from tests/dsp/ab.c.
 *
 * Three measures, because one is easy to pass by accident: peak difference
 * catches a wrong constant, correlation catches a shape change that stays
 * small, and a matching silence map catches a voice that retires a block early
 * or late — which nothing amplitude-based would notice.
 */
import { readFileSync } from 'node:fs';

const MAX_ABS_DIFF = 64;        /* of 32767, ~0.2% */
const MIN_CORRELATION = 0.999;

const [, , aPath, bPath] = process.argv;
const a = new Int16Array(readFileSync(aPath).buffer.slice(0));
const b = new Int16Array(readFileSync(bPath).buffer.slice(0));

const fail = (msg) => { console.log('not ok - ' + msg); process.exit(1); };

if (a.length !== b.length) fail(`length ${a.length} vs ${b.length}`);
if (a.length === 0) fail('rendered nothing');

let maxDiff = 0, maxAt = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
let silentA = 0, silentB = 0, bothSilent = 0;
for (let i = 0; i < a.length; i++) {
  const x = a[i], y = b[i];
  const d = Math.abs(x - y);
  if (d > maxDiff) { maxDiff = d; maxAt = i; }
  sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y;
  if (x === 0) silentA++;
  if (y === 0) silentB++;
  if (x === 0 && y === 0) bothSilent++;
}
const n = a.length;
const cov = sab / n - (sa / n) * (sb / n);
const va = saa / n - (sa / n) ** 2;
const vb = sbb / n - (sb / n) ** 2;
const corr = cov / Math.sqrt(va * vb);

/* Silence has to line up: a voice retiring a block early is inaudible in the
 * peak and the correlation, and is exactly the sort of drift a port makes. */
const silenceAgreement = bothSilent / Math.max(silentA, silentB);

console.log(`# ${n} samples  maxdiff ${maxDiff}  corr ${corr.toFixed(6)}  `
  + `silence ${silentA}/${silentB} agreeing ${(silenceAgreement * 100).toFixed(2)}%`);

if (maxDiff > MAX_ABS_DIFF) fail(`peak difference ${maxDiff} at sample ${maxAt}, limit ${MAX_ABS_DIFF}`);
if (!(corr > MIN_CORRELATION)) fail(`correlation ${corr.toFixed(6)}, want > ${MIN_CORRELATION}`);
if (silenceAgreement < 0.98) fail(`silence maps diverge: ${(silenceAgreement * 100).toFixed(2)}% agree`);

console.log('ok - the Rust engine matches the C within tolerance');
