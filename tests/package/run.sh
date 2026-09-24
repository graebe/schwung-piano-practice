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
  for (const phrase of ["turns into a circle", "an X", "where", "its own piano", "Wait stops", "Grace", "Guide pads", "Any octave", "index.json"]) {
    if (!text.includes(phrase)) throw new Error("help missing: " + phrase);
  }
'

test -f src/ui.js
test -f src/dsp/piano.c
test -f src/vendor/host/plugin_api_v1.h
test -f Dockerfile
test -f src/module.json
test -f src/help.json
test -f release.json
test -f LICENSE
test -f README.md
for mod in layout notation staff_render chart scoring generator exercise_io padmap view controls settings_def guess led_paint; do
  test -f "src/$mod.mjs"
done

node --check src/ui.js
for mod in src/*.mjs tools/*.mjs; do node --check "$mod"; done
sh -n scripts/package.sh scripts/install.sh scripts/verify-package.sh scripts/build.sh scripts/build-dsp.sh

# The shipped binary must be for the Move, not the machine that built it.
grep -q 'ARM aarch64' scripts/build-dsp.sh
if [ -f dist/dsp.so ]; then
  file dist/dsp.so | grep -q 'ARM aarch64' || { echo "dist/dsp.so is not aarch64" >&2; exit 1; }
fi

# The install must be atomic and must not eat the player's data.
grep -q 'piano-practice.install' scripts/install.sh
grep -q 'trap rollback' scripts/install.sh
grep -q 'settings.json' scripts/install.sh
grep -q 'exercises' scripts/install.sh
grep -q 'verify-package.sh' scripts/package.sh

# Nothing in src/ may import the desktop-only test harness.
! grep -rq 'screen_buffer' src/

sh scripts/package.sh >/dev/null
sh scripts/verify-package.sh
