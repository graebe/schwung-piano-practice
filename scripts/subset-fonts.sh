#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Torben Gräber
#
# The browser UI's notation font: Bravura, cut down to the SMuFL glyphs the
# music components draw, renamed, as WOFF.
#
#   scripts/subset-fonts.sh <dir holding Bravura.otf and Bravura-OFL.txt>
#
# The directory is the plugin repository's plugins/_shared/ui/fonts/bravura,
# Bravura 1.482 unmodified; both files are checked against the SHA-256 sums its
# README records, so the output can only come from that release.
#
# WRITES
#   web/fonts/NINotation.woff            the subset
#   web/fonts/Bravura-OFL.txt            its licence, which travels with it
#   web/src/music/notation-metrics.json  units per em and each glyph's advance,
#                                        read from the subset itself, so the
#                                        staff never states a width by hand
#
# RENAMED, BECAUSE THE LICENCE SAYS SO. Bravura's OFL reserves the name
# "Bravura", and a subset is a Modified Version: it may not be presented under
# the Reserved Font Name. So the user-facing names (name IDs 1, 3, 4, 6, 16, 17
# and the CFF font name, FullName and FamilyName) become "NI Notation"; the
# copyright notice, the licence and the trademark notice stay as they are, as
# the OFL requires.
#
# WOFF, not WOFF2: WOFF2 needs fonttools' Brotli extension, which this
# machine's fonttools does not have. With it, this becomes --flavor woff2 and
# a file name.
#
# Needs pyftsubset and ttx (fonttools) and node.
set -eu

SRC=${1:?usage: subset-fonts.sh <dir with Bravura.otf and Bravura-OFL.txt>}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
FONTS="$ROOT/web/fonts"
METRICS="$ROOT/web/src/music/notation-metrics.json"

OTF_SHA=cdf0f893ee1fdb64b7f6713d71ee0dcfc349c0ac01429a8e451b01a9e79f5f3b
OFL_SHA=c24929be7028026a65ee8894da1e3c36d2a4ccce0548d9ba8ba64509f46319ee

# The glyphs, by SMuFL code point. Adding one here is the whole of adding it.
#   E050 gClef          E062 fClef
#   E080-E089 timeSig0-9 (the time signature in the staff's gutter)
#   E0A3 noteheadHalf   (a judged note: the open head)
#   E0A4 noteheadBlack  (a note still to play)
#   E0A9 noteheadXBlack (a missed note)
#   E260 flat  E261 natural  E262 sharp  E263 doubleSharp  E264 doubleFlat
GLYPHS="U+E050,U+E062,U+E080-E089,U+E0A3,U+E0A4,U+E0A9,U+E260-E264"

for tool in pyftsubset ttx node; do
  command -v "$tool" >/dev/null || { echo "subset-fonts: $tool not found" >&2; exit 1; }
done

sum() { shasum -a 256 "$1" | cut -d' ' -f1; }
[ "$(sum "$SRC/Bravura.otf")" = "$OTF_SHA" ] || { echo "subset-fonts: $SRC/Bravura.otf is not Bravura 1.482" >&2; exit 1; }
[ "$(sum "$SRC/Bravura-OFL.txt")" = "$OFL_SHA" ] || { echo "subset-fonts: $SRC/Bravura-OFL.txt is not Bravura 1.482's licence" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

pyftsubset "$SRC/Bravura.otf" --unicodes="$GLYPHS" --layout-features='' \
  --name-IDs='*' --name-languages='*' --notdef-outline \
  --output-file="$TMP/subset.otf"
ttx -q -o "$TMP/subset.ttx" "$TMP/subset.otf"

# Rename and read the metrics, from the XML ttx made.
node --input-type=module - "$TMP/subset.ttx" "$TMP/renamed.ttx" "$METRICS" "$GLYPHS" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const [src, dst, metricsPath, glyphs] = process.argv.slice(2);
let xml = readFileSync(src, 'utf8');
const fail = (m) => { console.error(`subset-fonts: ${m}`); process.exit(1); };

const NAMES = { 1: 'NI Notation', 3: '1.482;NI;NINotation', 4: 'NI Notation', 6: 'NINotation',
                16: 'NI Notation', 17: 'Regular' };
xml = xml.replace(/(<namerecord nameID="(\d+)"[^>]*>)([\s\S]*?)(<\/namerecord>)/g, (all, open, id, body, close) => {
  if (!(id in NAMES)) return all;
  if (id !== '17' && !/Bravura/.test(body)) fail(`name ID ${id} does not name Bravura: ${body.trim()}`);
  return `${open}\n      ${NAMES[id]}\n    ${close}`;
});
/* The CFF font's own name is the CFFFont element's; its full and family names
 * are entries of the top dictionary. */
if (!/<CFFFont name="Bravura">/.test(xml)) fail('the CFF font is not called Bravura');
xml = xml.replace('<CFFFont name="Bravura">', '<CFFFont name="NINotation">');
for (const tag of ['FullName', 'FamilyName']) {
  const re = new RegExp(`<${tag} value="Bravura"/>`);
  if (!re.test(xml)) fail(`the CFF table's ${tag} is not Bravura`);
  xml = xml.replace(re, `<${tag} value="NI Notation"/>`);
}
for (const m of xml.matchAll(/<namerecord nameID="(\d+)"[^>]*>([\s\S]*?)<\/namerecord>/g))
  if (['1', '3', '4', '6', '16'].includes(m[1]) && /Bravura/.test(m[2])) fail(`name ID ${m[1]} still says Bravura`);
writeFileSync(dst, xml);

/* Metrics: the cmap's glyph for each wanted code point, and its advance. */
const upem = Number(/<unitsPerEm value="(\d+)"\/>/.exec(xml)?.[1]);
if (!upem) fail('no unitsPerEm');
const cmap = new Map();
for (const m of xml.matchAll(/<map code="0x([0-9a-f]+)" name="([^"]+)"\/>/g)) cmap.set(parseInt(m[1], 16), m[2]);
const hmtx = new Map();
for (const m of xml.matchAll(/<mtx name="([^"]+)" width="(\d+)" lsb="(-?\d+)"\/>/g)) hmtx.set(m[1], Number(m[2]));
const wanted = [];
for (const part of glyphs.split(',')) {
  const [a, b] = part.replace(/U\+/g, '').split('-').map((h) => parseInt(h, 16));
  for (let cp = a; cp <= (b ?? a); cp++) wanted.push(cp);
}
const advance = {};
for (const cp of wanted) {
  const name = cmap.get(cp);
  if (!name || !hmtx.has(name)) fail(`U+${cp.toString(16).toUpperCase()} is not in the subset`);
  advance[cp.toString(16).toUpperCase()] = hmtx.get(name);
}
writeFileSync(metricsPath, JSON.stringify({
  font: 'NI Notation: Bravura 1.482, subset by scripts/subset-fonts.sh',
  unitsPerEm: upem,
  advance,
}, null, 1) + '\n');
JS

ttx -q --no-recalc-timestamp --flavor woff -o "$FONTS/NINotation.woff" "$TMP/renamed.ttx"
cp "$SRC/Bravura-OFL.txt" "$FONTS/Bravura-OFL.txt"

ls -l "$FONTS/NINotation.woff" "$FONTS/Bravura-OFL.txt" "$METRICS"
