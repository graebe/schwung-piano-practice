// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * Three lcov files in, one report out.
 *
 * WHY THE MERGE IS OF LCOV AND NOT OF PROFDATA.
 *
 * The C, the C++ and the Rust all instrument through LLVM, so merging their
 * .profraw into one .profdata and asking llvm-cov once is the obvious move --
 * and it does not work here. rustc carries its own LLVM, Xcode carries
 * another, and a .profraw written by one is refused by the other's
 * llvm-profdata with "unsupported instrumentation profile format version",
 * which names neither toolchain. cargo-llvm-cov exists precisely to use
 * rustup's matching tools for the Rust half.
 *
 * So each toolchain reduces its own profile to lcov -- a text format that has
 * not changed in twenty years -- and the merge happens here, where it is
 * arithmetic over integers rather than a version negotiation.
 *
 * WHY THE HTML IS WRITTEN HERE AND NOT BY genhtml. genhtml could not have
 * produced ONE page spanning all three languages, which is the only form in
 * which the total means anything.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.env.COVERAGE_ROOT ?? process.cwd();
const OUT = process.env.COVERAGE_OUT ?? join(ROOT, 'build', 'coverage');

/*
 * WHAT COUNTS. Everything first-party and nothing else -- the point of a
 * coverage number is to describe code this repository is responsible for.
 *
 * Tests are excluded from the denominator on purpose: a test file is executed
 * by definition, so counting it inflates every number by however many tests
 * there are, and the figure goes UP when you add an untested feature with a
 * test file beside it.
 */
const INCLUDE = [/^src\//, /^web\/src\//, /^dsp\//];
const EXCLUDE = [
  /^external\//, /^build/, /node_modules\//, /^target\//, /\/target\//,
  /^src\/vendor\//, /^src\/exercises\//,
  /(^|\/)tests?\//, /\.test\.mjs$/, /(^|\/)dist\//,
  /* A crate's unit tests, in the `#[cfg(test)] mod tests;` file beside the
   * code: test code, as surely as anything under tests/. */
  /(^|\/)tests\.rs$/,
];

const LANG = (p) => {
  const e = extname(p);
  if (e === '.rs') return 'rust';
  if (['.js', '.jsx', '.mjs'].includes(e)) return 'js';
  if (['.cpp', '.cc', '.cxx', '.mm'].includes(e)) return 'cpp';
  if (e === '.c') return 'c';
  /* A header follows the company it keeps: the plugin shells are C++, the
   * engines' published ABIs are C. */
  if (['.h', '.hpp'].includes(e)) return 'c';
  return 'other';
};

/*
 * THE UNIT A FLOOR APPLIES TO, derived rather than listed.
 *
 * A migration that lands a new plugin must not be able to arrive without a
 * floor -- an enumerated list would simply not mention it, the file would fall
 * into no unit, and the total would rise because a well-tested engine now has
 * more company. So the unit is read off the path, and anything new is a unit
 * the moment its first file appears.
 */
const unitOf = (p) => {
  let m;
  /* The Move's adapter apart from the module's portable core. */
  if (p === 'src/ui.js') return 'device';
  if (p.startsWith('src/')) return 'core';
  if ((m = p.match(/^web\/src\/[^/]+/))) return m[0].replace('/src', '');
  if ((m = p.match(/^dsp\/[^/]+/))) return m[0];
  return 'other';
};

/*
 * ui_smoke and ui_trace run ui.js from a staged copy of src/ in a temp
 * directory (its absolute device imports rewritten to local stubs, line for
 * line), so V8 names the copy. It is the same code; it is counted as src/.
 */
const STAGED = /\/pp-(?:smoke|trace)-[^/]+\/src\/(.*)$/;

const norm = (p) => {
  const staged = p.match(STAGED);
  if (staged) return 'src/' + staged[1];
  const abs = p.startsWith('/') ? p : join(ROOT, p);
  return relative(ROOT, abs).split('\\').join('/');
};

const keep = (p) => INCLUDE.some((r) => r.test(p)) && !EXCLUDE.some((r) => r.test(p));

/*
 * The floors are read here only to LABEL the report -- the judging is the
 * floor test's job. Without them a reader of "100.0%" beside a plugin has no
 * way to see that the plugin class beside the counted files is exempt and
 * uncounted.
 */
let FLOORS = { exempt: {}, units: {}, floor: 80 };
try {
  FLOORS = JSON.parse(readFileSync(join(ROOT, 'tests', 'coverage.floors.json'), 'utf8'));
} catch { /* the report still stands without them; it just cannot annotate */ }

/* ------------------------------------------------------------------ lcov */

/*
 * Records accumulate rather than replace. The same file legitimately appears
 * in more than one tracefile -- Wire.cpp is compiled into the plugin and into
 * its test binary -- and a line covered by either run is covered.
 */
function parseLcov(text, files) {
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      const p = norm(line.slice(3));
      if (!keep(p)) { cur = null; continue; }
      cur = files.get(p) ?? { lines: new Map(), funcs: new Map(), branches: new Map() };
      files.set(p, cur);
    } else if (!cur) {
      continue;
    } else if (line.startsWith('DA:')) {
      const [n, c] = line.slice(3).split(',');
      cur.lines.set(+n, (cur.lines.get(+n) ?? 0) + (+c || 0));
    } else if (line.startsWith('FNDA:')) {
      const i = line.indexOf(',');
      const c = +line.slice(5, i), name = line.slice(i + 1);
      cur.funcs.set(name, (cur.funcs.get(name) ?? 0) + (c || 0));
    } else if (line.startsWith('FN:')) {
      const i = line.indexOf(',');
      const name = line.slice(i + 1);
      if (!cur.funcs.has(name)) cur.funcs.set(name, 0);
    } else if (line.startsWith('BRDA:')) {
      const [l, b, br, taken] = line.slice(5).split(',');
      const key = `${l}:${b}:${br}`;
      const hit = taken === '-' ? 0 : +taken || 0;
      cur.branches.set(key, (cur.branches.get(key) ?? 0) + hit);
    } else if (line === 'end_of_record') {
      cur = null;
    }
  }
}

const pct = (hit, total) => (total === 0 ? null : (hit * 100) / total);

function tally(m) {
  let hit = 0;
  for (const v of m.values()) if (v > 0) hit++;
  return { hit, total: m.size, pct: pct(hit, m.size) };
}

/* ------------------------------------------------------------------ main */

const sources = process.argv.slice(2);
if (sources.length === 0) {
  console.error('usage: coverage-report.mjs <lcov file>...');
  process.exit(2);
}

const files = new Map();
const seen = [];
for (const src of sources) {
  if (!existsSync(src)) continue;
  parseLcov(readFileSync(src, 'utf8'), files);
  seen.push(relative(ROOT, src));
}

if (files.size === 0) {
  console.error(
    'No first-party files in any tracefile. Either nothing was instrumented,\n' +
    'or every path was filtered out -- check INCLUDE/EXCLUDE at the top of\n' +
    'scripts/coverage-report.mjs against what the tracefiles actually contain:\n' +
    sources.map((s) => `  ${s}`).join('\n'));
  process.exit(1);
}

/*
 * THE FILES NO TRACEFILE MENTIONS, which is the number's one real way to lie.
 *
 * lcov only records what was loaded. A source file that no test ever reaches
 * does not appear as 0% -- it does not appear AT ALL, and every percentage
 * above is computed without it. This is not hypothetical: the first run of
 * this script reported 54.4% while modules/trance-gate/ui_chain.js, 1,315
 * lines of it, was invisible, and plugins/trance-gate read 100% because only
 * Wire.cpp was linked into a test binary and TranceGate.cpp was not.
 *
 * A coverage figure that rises when you add an untested file is worse than no
 * figure, because it is trusted. So the tree is listed and anything missing
 * from every tracefile is named.
 *
 * THE TREE IS WHAT GIT SEES: the tracked files and the untracked ones it does
 * not ignore, so a new file counts before its first commit. What .gitignore
 * keeps out is not first-party -- build output, and what a removed build left
 * behind in an older checkout (the iPlug2 web editors' output in each plugin's resources/)
 * -- and a walk of the disk counted it as untested source.
 *
 * HEADERS ARE NOT COUNTED HERE. A header of declarations legitimately produces
 * no coverage record, so flagging them would be noise that teaches the reader
 * to skim the list -- and this list is only useful if it is read.
 */
const SOURCE = /\.(c|cpp|cc|cxx|mm|rs|js|jsx|mjs)$/;

const onDisk = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'src', 'web/src', 'dsp'],
  { cwd: ROOT, encoding: 'utf8' },
)
  .split('\0')
  .filter((p) => SOURCE.test(p) && existsSync(join(ROOT, p)))
  .map((p) => norm(p))
  .filter(keep)
  .sort();

/*
 * EXEMPT FILES, as opposed to exempt units: a file that cannot be built into
 * anything a test can run, inside a unit whose other files can -- the plugin
 * classes, which compile only inside a plugin-format target, beside the
 * Params/State/Wire files lifted out of them for exactly that reason. The file
 * leaves the unit's numbers and the absent list; the unit is still judged.
 */
const exemptFile = (p) => !!FLOORS.exempt_files?.[p];

/*
 * A RUST FILE NO TRACEFILE MENTIONS HAS NO CODE, rather than no test. cargo
 * compiles every module of every workspace crate into its test binary, and
 * llvm-cov records every function it compiled, run or not -- so the only Rust
 * file missing from rust.info is one of declarations: `pub mod` lines, a table
 * of constants. Listing those as "never loaded" would teach the reader to skim
 * the list. The other languages get no such blanket pass: a C or C++ file is
 * absent exactly when nothing loaded it.
 */
const declarationsOnly = (p) => LANG(p) === 'rust';

const absent = onDisk
  .filter((p) => !files.has(p) && !exemptFile(p) && !declarationsOnly(p))
  .map((p) => ({ path: p, language: LANG(p), unit: unitOf(p) }));

const perFile = [...files.entries()]
  .filter(([path]) => !exemptFile(path))
  .map(([path, rec]) => ({
    path,
    language: LANG(path),
    unit: unitOf(path),
    lines: tally(rec.lines),
    functions: tally(rec.funcs),
    branches: tally(rec.branches),
  }))
  .sort((a, b) => a.path.localeCompare(b.path));

const roll = (rows) => {
  const add = (k) => rows.reduce(
    (a, r) => ({ hit: a.hit + r[k].hit, total: a.total + r[k].total }),
    { hit: 0, total: 0 });
  const l = add('lines'), f = add('functions'), b = add('branches');
  return {
    lines: { ...l, pct: pct(l.hit, l.total) },
    functions: { ...f, pct: pct(f.hit, f.total) },
    branches: { ...b, pct: pct(b.hit, b.total) },
  };
};

const groupBy = (key) => {
  const out = {};
  for (const r of perFile) (out[r[key]] ??= []).push(r);
  /* A unit that is ENTIRELY untested has no measured rows at all, so it has to
   * be created from the absent list or it would simply not be listed -- which
   * is the same disappearance one level up. */
  for (const a of absent) (out[a[key]] ??= []);
  return Object.fromEntries(
    Object.entries(out).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, rows]) => {
        const miss = absent.filter((a) => a[key] === k);
        return [k, {
          ...roll(rows),
          files: rows.length,
          absent: miss.length,
          absentFiles: miss.map((a) => a.path),
          exempt: FLOORS.exempt?.[k] ?? null,
          floor: FLOORS.units?.[k] ?? FLOORS.floor,
        }];
      }));
};


const report = {
  generated: new Date().toISOString(),
  sources: seen,
  total: roll(perFile),
  exemptFiles: Object.entries(FLOORS.exempt_files ?? {})
    .map(([path, reason]) => ({ path, unit: unitOf(path), reason })),
  absent: {
    count: absent.length,
    note: 'First-party source files no tracefile mentions. They are NOT in the '
        + 'percentages above -- lcov records only what was loaded, so an '
        + 'unreached file is absent rather than zero. Treat the totals as '
        + 'upper bounds while this is non-empty.',
    files: absent,
  },
  languages: groupBy('language'),
  units: groupBy('unit'),
  files: perFile,
};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'coverage.json'), JSON.stringify(report, null, 2) + '\n');

/* ---------------------------------------------------------------- human */

const p1 = (v) => (v === null ? '    -' : `${v.toFixed(1).padStart(5)}%`);

const lines = [];
lines.push('  coverage, by unit');
lines.push('');
for (const [name, u] of Object.entries(report.units)) {
  const tail = u.exempt ? '  exempt' : u.absent ? `  (+${u.absent} never loaded)` : '';
  lines.push(`    ${name.padEnd(44)} ${p1(u.lines.pct)}  ` +
             `${String(u.lines.hit).padStart(5)}/${String(u.lines.total).padEnd(5)} lines${tail}`);
}
lines.push('');
lines.push('  by language');
lines.push('');
for (const [name, l] of Object.entries(report.languages)) {
  lines.push(`    ${name.padEnd(44)} ${p1(l.lines.pct)}  ` +
             `${String(l.lines.hit).padStart(5)}/${String(l.lines.total).padEnd(5)} lines`);
}
lines.push('');
lines.push(`    ${'TOTAL'.padEnd(44)} ${p1(report.total.lines.pct)}  ` +
           `${report.total.lines.hit}/${report.total.lines.total} lines, ` +
           `${p1(report.total.functions.pct).trim()} of functions, ` +
           `${p1(report.total.branches.pct).trim()} of branches`);
lines.push('');

if (report.exemptFiles.length > 0) {
  lines.push('  exempt, and in no figure above (tests/coverage.floors.json says why):');
  lines.push('');
  for (const e of report.exemptFiles) lines.push(`    ${e.path}`);
  lines.push('');
}

if (report.absent.count > 0) {
  lines.push('');
  lines.push(`  ${report.absent.count} first-party file(s) NO TEST EVER LOADS, so the figures`);
  lines.push('  above are computed without them and are upper bounds:');
  lines.push('');
  for (const a of report.absent.files)
    lines.push(`    ${a.path}`);
  lines.push('');
}

const summary = lines.join('\n');
writeFileSync(join(OUT, 'summary.txt'), summary + '\n');

/* ----------------------------------------------------------------- html */

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const FLOOR = Number(process.env.COVERAGE_FLOOR ?? 80);
const cls = (v) => (v === null ? 'na' : v >= FLOOR ? 'ok' : v >= FLOOR * 0.6 ? 'mid' : 'low');
const cell = (t) => `<td class="n ${cls(t.pct)}">${t.pct === null ? '&mdash;' : t.pct.toFixed(1) + '%'}` +
  `<span class="c">${t.hit}/${t.total}</span></td>`;

const rowsFor = (rows) => rows.map((r) => `<tr><td class="p">${esc(r.path)}</td>` +
  `<td class="g">${r.language}</td>${cell(r.lines)}${cell(r.functions)}${cell(r.branches)}</tr>`).join('\n');

const section = (title, obj) => `<h2>${esc(title)}</h2><div class="wrap"><table><thead><tr>` +
  `<th>name</th><th>files</th><th>unloaded</th><th>lines</th><th>functions</th><th>branches</th>` +
  `</tr></thead><tbody>` +
  Object.entries(obj).map(([k, v]) => {
    /* The exemption's own words, where the number is -- a reader who sees
     * "100.0%" next to a plugin deserves to find out on the same line that
     * the shell beside it is not being counted. */
    const mark = v.exempt
      ? `<span class="ex" title="${esc(v.exempt)}">exempt</span>`
      : '';
    const un = v.absent ? `<span class="low">${v.absent}</span>` : '<span class="na">0</span>';
    return `<tr><td class="p">${esc(k)} ${mark}</td>` +
      `<td class="g">${v.files}</td><td class="n">${un}</td>` +
      `${cell(v.lines)}${cell(v.functions)}${cell(v.branches)}</tr>`;
  }).join('\n') +
  `</tbody></table></div>`;

mkdirSync(join(OUT, 'html'), { recursive: true });
writeFileSync(join(OUT, 'html', 'index.html'), `<!doctype html>
<meta charset="utf-8">
<title>Piano Practice coverage</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#16161a; --dim:#6b6b76; --line:#e4e4ea;
          --ok:#1a7f4b; --mid:#9a6b00; --low:#b3261e; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#16161a; --fg:#ecedf0; --dim:#9a9aa6; --line:#2c2c34;
            --ok:#52c98a; --mid:#e0ad3a; --low:#f2776b; }
  }
  body { background:var(--bg); color:var(--fg); margin:0; padding:2.5rem 1.5rem;
         font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; }
  main { max-width:64rem; margin:0 auto; }
  h1 { font-size:1.15rem; margin:0 0 .25rem; }
  h2 { font-size:.95rem; margin:2.25rem 0 .6rem; color:var(--dim);
       text-transform:lowercase; letter-spacing:.04em; }
  .sub { color:var(--dim); margin:0 0 1.5rem; font-size:.85rem; }
  .tot { font-size:2.4rem; font-weight:600; letter-spacing:-.02em; }
  table { border-collapse:collapse; width:100%; font-size:.82rem; }
  th { text-align:right; font-weight:500; color:var(--dim); padding:.3rem .5rem;
       border-bottom:1px solid var(--line); }
  th:first-child { text-align:left; }
  td { padding:.28rem .5rem; border-bottom:1px solid var(--line); }
  td.p { word-break:break-all; }
  td.g { color:var(--dim); text-align:right; }
  td.n { text-align:right; white-space:nowrap; }
  .c { color:var(--dim); margin-left:.5rem; font-size:.9em; }
  .ok { color:var(--ok); } .mid { color:var(--mid); } .low { color:var(--low); }
  .na { color:var(--dim); }
  .wrap { overflow-x:auto; }
  .warn { border:1px solid var(--low); border-radius:.4rem; padding:.9rem 1.1rem;
          margin:1.5rem 0; font-size:.82rem; }
  .warn strong { color:var(--low); }
  .warn ul { margin:.6rem 0 0; padding-left:1.1rem; }
  .warn li { word-break:break-all; }
  .ex { color:var(--mid); border:1px solid var(--mid); border-radius:.25rem;
        padding:0 .3rem; font-size:.75em; cursor:help; }
</style>
<main>
  <h1>Piano Practice coverage</h1>
  <p class="sub">${esc(report.generated)} &middot; floor ${FLOOR}% &middot;
     from ${report.sources.map(esc).join(', ')}</p>
  <p class="tot ${cls(report.total.lines.pct)}">${report.total.lines.pct.toFixed(1)}%</p>
  <p class="sub">${report.total.lines.hit} of ${report.total.lines.total} lines,
     across ${report.files.length} first-party files. Tests are not counted:
     a test file is executed by definition, so counting one raises the number
     without testing anything.</p>
  ${report.absent.count === 0 ? '' : `<div class="warn">
    <strong>${report.absent.count} first-party file${report.absent.count === 1 ? '' : 's'}
    no test ever loads.</strong> lcov records only what was loaded, so these are
    absent from every percentage on this page rather than counted as zero &mdash;
    treat the totals as upper bounds.
    <ul>${report.absent.files.map((a) => `<li>${esc(a.path)}</li>`).join('')}</ul>
  </div>`}
  ${section('by unit', report.units)}
  ${report.exemptFiles.length === 0 ? '' : `<h2>exempt files</h2><div class="wrap"><table>
    <thead><tr><th>path</th><th>why</th></tr></thead><tbody>
    ${report.exemptFiles.map((e) => `<tr><td class="p">${esc(e.path)}</td>` +
      `<td>${esc(e.reason)}</td></tr>`).join('\n')}
  </tbody></table></div>`}
  ${section('by language', report.languages)}
  <h2>by file</h2>
  <div class="wrap"><table><thead><tr><th>path</th><th>lang</th><th>lines</th>
    <th>functions</th><th>branches</th></tr></thead><tbody>
${rowsFor(report.files)}
  </tbody></table></div>
</main>
`);

console.log(summary);
console.log(`  written: ${relative(ROOT, OUT)}/{coverage.json,summary.txt,html/index.html}\n`);

/* ------------------------------------------------------------ the floor */
/*
 * With COVERAGE_ENFORCE=1 (scripts/coverage.sh), the floor is judged here: the
 * total, every unit not exempted for a stated reason, and the list of files no
 * test loads, which must be empty — a file nothing loads is in no percentage,
 * so the floor could not see it otherwise.
 */
if (process.env.COVERAGE_ENFORCE === '1' && FLOORS.enforcing) {
  const fails = [];
  const floor = FLOORS.floor;
  if ((report.total.lines.pct ?? 0) < floor) fails.push(`total ${report.total.lines.pct.toFixed(1)}% < ${floor}%`);
  for (const [name, u] of Object.entries(report.units)) {
    if (u.exempt) continue;
    const f = u.floor ?? floor;
    if (u.lines.pct !== null && u.lines.pct < f) fails.push(`${name} ${u.lines.pct.toFixed(1)}% < ${f}%`);
  }
  for (const a of report.absent.files) fails.push(`${a.path}: no test loads it`);
  if (fails.length) {
    console.error('coverage below the floor:\n' + fails.map((f) => '  ' + f).join('\n'));
    process.exitCode = 1;
  }
}
