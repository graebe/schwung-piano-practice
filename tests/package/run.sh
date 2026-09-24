#!/usr/bin/env sh
set -eu

node -e '
  const fs = require("fs");
  const manifest = JSON.parse(fs.readFileSync("src/module.json", "utf8"));
  const release = JSON.parse(fs.readFileSync("release.json", "utf8"));
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const help = JSON.parse(fs.readFileSync("src/help.json", "utf8"));

  if (manifest.id !== "piano-practice") throw new Error("wrong module id");
  if (manifest.component_type !== "tool") throw new Error("must be a tool");
  if (manifest.api_version !== 2) throw new Error("api_version must be 2");
  if (!manifest.tool_config || manifest.tool_config.overtake !== true) throw new Error("pads need overtake");
  if (manifest.capabilities.note_passthrough !== undefined) throw new Error("note_passthrough is inert in this host");
  if (release.version !== manifest.version) throw new Error("release version mismatch");
  if (pkg.version !== manifest.version) throw new Error("package version mismatch");
  if (!release.download_url.includes("/v" + manifest.version + "/")) throw new Error("release URL version mismatch");

  const text = help.children.flatMap(s => s.lines).join(" ");
  for (const phrase of ["turns into a circle", "an X", "where", "its own piano", "Wait stops", "Grace", "Guide pads", "Any octave", "index.json", "Pick the song", "L3 Both hands"]) {
    if (!text.includes(phrase)) throw new Error("help missing: " + phrase);
  }
'

test -f src/ui.js
test -f src/vendor/host/plugin_api_v1.h

# The DSP is Rust. The reusable half must stay separable from the synth — that
# split is what makes the next module an impl rather than a copy.
test -f dsp/Cargo.toml
test -f dsp/schwung-plugin/src/lib.rs
test -f dsp/piano/src/lib.rs
! grep -rq 'unsafe' dsp/piano/src/   # every FFI hazard lives in schwung-plugin
test -f Dockerfile
test -f src/module.json
test -f src/help.json
test -f release.json
test -f LICENSE
test -f README.md
test -f THIRD_PARTY_LICENSES.md

# One licence, stated once. module.json said MIT while LICENSE was GPL-3 for
# three releases, and the catalog entry repeated the module.json answer.
grep -q '"license": "MIT"' src/module.json
grep -q '^MIT License' LICENSE
grep -q 'Torben Gräber' LICENSE
! grep -q 'GNU GENERAL PUBLIC LICENSE' LICENSE

# Every crate compiled into dsp.so must be named in the notice file, or the
# attribution silently rots the next time a dependency is added.
for crate in $(sed -n 's/^name = "\(.*\)"$/\1/p' dsp/Cargo.lock); do
  case "$crate" in
    piano|schwung-plugin) continue ;;   # ours
  esac
  grep -q "$crate" THIRD_PARTY_LICENSES.md \
    || { echo "THIRD_PARTY_LICENSES.md does not mention $crate" >&2; exit 1; }
done
for mod in layout notation staff_render chart scoring generator exercise_io levels padmap view controls settings_def guess led_paint chords stats choices; do
  test -f "src/$mod.mjs"
done

node --check src/ui.js
test -f tests/ui_smoke.test.mjs   # ui.js must be executed by the suite, not only read
for mod in src/*.mjs tools/*.mjs; do node --check "$mod"; done
sh -n scripts/package.sh scripts/install.sh scripts/verify-package.sh scripts/build.sh scripts/build-dsp.sh

# The shipped binary must be for the Move, not the machine that built it —
# and must not out-run the device's glibc or balloon in size. Each of these is
# a guard whose absence is invisible until a device refuses to load the module.
grep -q 'ARM aarch64' scripts/build-dsp.sh
grep -q 'GLIBC_MAX' scripts/build-dsp.sh
grep -q 'SIZE_MAX' scripts/build-dsp.sh

# A Rust panic must abort, never unwind out through extern "C".
grep -q 'panic = "abort"' dsp/Cargo.toml
grep -q 'clippy::indexing_slicing' dsp/piano/src/lib.rs
if [ -f dist/dsp.so ]; then
  file dist/dsp.so | grep -q 'ARM aarch64' || { echo "dist/dsp.so is not aarch64" >&2; exit 1; }
fi

# The install must be atomic and must not eat the player's data.
grep -q 'piano-practice.install' scripts/install.sh
grep -q 'trap rollback' scripts/install.sh
grep -q 'settings.json' scripts/install.sh
# The progress history must survive an update. This is invisible when broken
# until someone's trend is already gone, so it is asserted rather than trusted.
grep -q 'stats.json' scripts/install.sh
grep -q 'exercises' scripts/install.sh
grep -q 'verify-package.sh' scripts/package.sh

# Nothing in src/ may import the desktop-only test harness.
! grep -rq 'screen_buffer' src/

# Packaging needs a cross-compiled dist/dsp.so, which takes Docker and an ARM
# toolchain. Everything above is static and must run anywhere — on a fresh
# clone and on a CI runner that has not built — so the tarball assertions run
# only when there is something to assert about, and say when they do not.
#
# Nothing is lost by skipping them there: scripts/build.sh runs package.sh and
# verify-package.sh itself, so the release job proves the tarball before it
# ever attaches one.
if [ -f dist/dsp.so ]; then
  sh scripts/package.sh >/dev/null
  sh scripts/verify-package.sh
else
  echo "package: skipped the tarball checks — no dist/dsp.so (run scripts/build.sh first)"
fi
