# Third-party licences

Piano Practice is GPL-3.0-or-later (see [LICENSE](LICENSE)), copyright © 2026
Torben Gräber. One third-party library is compiled into the shipped binaries,
and its notice has to travel with them. MIT is compatible with the GPL: the combined
work is conveyed under the GPL, and libm's own notice is kept intact.

## libm 0.2.16 — MIT

The piano engine (`dsp/piano-engine`) uses [`libm`](https://crates.io/crates/libm)
for `sinf`, `powf`, `expf` and `sqrtf`, so libm is compiled into both builds of
it: the Move's `dsp.so` and the browser's `piano.wasm`. The engine is `no_std`,
so it cannot call the platform's maths library through Rust's standard library
and uses this crate instead — which is also what makes the two builds compute
the same samples: one implementation of each function, in Rust, on both.

The crate is offered under MIT or Apache-2.0; it is taken here under **MIT**,
and its notice is reproduced in full as that licence requires.

> rust-lang/libm as a whole is available for use under the MIT license:
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

`libm` is the only third-party Rust crate. The other crates in `dsp/` —
`piano-engine`, `piano`, `piano-wasm` and `schwung-plugin` — are this module's
own, GPL-3.0-or-later.

## solid-js 1.9.16 — MIT

The web page (`web/`, built to `dist/web`) is written with
[Solid](https://www.solidjs.com). Its runtime is bundled into the page's
script; the build (scripts/vite-licenses.mjs) writes this notice into
`assets/THIRD_PARTY_LICENSES.txt` beside it, and refuses to build if a bundled
package is not listed here.

> MIT License
>
> Copyright (c) 2016-2025 Ryan Carniato
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## vite 6.4.3 — MIT

The build tool. Only its module-preload polyfill, a few dozen lines, is
bundled into the page; the rest of Vite stays on the developer's machine.

> Vite core license
> Vite is released under the MIT license:
>
> MIT License
>
> Copyright (c) 2019-present, VoidZero Inc. and Vite contributors
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## JetBrains Mono — OFL-1.1

The web page's typeface, the Ultraviolet design system's only one
(`web/fonts/JetBrainsMono-*.woff`). Shipped as separate font files with their
licence, `web/fonts/OFL.txt`. Fonts under the SIL Open Font License may be
bundled with any software; the licence covers the font files only.

## Bravura, as NI Notation — OFL-1.1

The staff's clefs, noteheads and accidentals (SMuFL glyphs) are a subset of
Steinberg's Bravura, `web/fonts/NINotation.woff`, made by
`scripts/subset-fonts.sh`. Bravura's licence reserves its name for unmodified
copies, and a subset is a modification, so it ships as "NI Notation" with the
copyright, licence and reserved-name notices unchanged in
`web/fonts/Bravura-OFL.txt`.

## Not third-party

- `web/src/kit/` is the Ultraviolet Solid kit from neon-ingvy-audio-plugins
  (commit 4e15cc8), by the same author, GPL-3.0-or-later here like the rest of
  this module; each file names its source.

- `src/vendor/host/plugin_api_v1.h` is Schwung's plugin API header
  ([charlesvestal/schwung](https://github.com/charlesvestal/schwung), MIT), kept
  here so the module builds without a checkout of the host.
- The exercises are traditional and classical melodies in the public domain —
  Ode to Joy, Twinkle, Mary's Lamb, Frère Jacques, Jingle Bells, Greensleeves,
  Für Elise, Minuet in G, Amazing Grace, Scarborough Fair, House of the Rising
  Sun, When the Saints Go Marching In, Auld Lang Syne, Korobeiniki, London
  Bridge, Brahms' Wiegenlied (Op. 49 No. 4, 1868), Pachelbel's Canon in D and
  the first eight bars of Bach's Prelude in C (BWV 846) — transcribed for this
  module. The composers died in 1897, 1706 and 1750.

  Each was transcribed from the **traditional melody**, never from a particular
  modern arrangement or recording of it. That distinction is the whole question
  for the folk tunes: the tune itself is out of copyright, while a named
  arrangement of it carries its own, fresh copyright. So "House of the Rising
  Sun" here is the traditional song and not The Animals' 1964 arrangement, and
  "Korobeiniki" is the nineteenth-century Russian folk song and not the
  arrangement any game shipped.

  The left-hand parts and the harmonisations at levels 2 and 3 were written for
  this module and are GPL-3.0-or-later with everything else. So are the genre studies —
  Ambient, Cinematic, Funk Clav, House Stabs, Indie Anthem, Lofi Sunday, Minor
  Trap, Neo Soul, Pop Ballad, Synthwave — which are original pieces written to
  drill a style, not transcriptions of anything. The fourteen techno studies
  (`techno-*.json`) are original in the same way: each drills a technique, and
  the README names the record it is associated with only as a reference.
- The Basics chord, progression and random lessons are generated by
  `src/chord_lessons.mjs`. They are this module's own code and output.
- **The electronic track studies are not transcriptions either.** Each is named
  after a published track and uses only what copyright does not protect in it:
  the chord progression and its harmonic rhythm, the tempo, the key, and the
  generic feel of the keyboard part (offbeat stabs, a held pad). Courts treat
  the basic chord progressions of popular music as unoriginal and unprotectable
  — most recently in the 2024 Second Circuit ruling for Ed Sheeran over "Let's
  Get It On" — while a melody is protected. So no melody, hook, riff, lyric,
  sample or sound of any track is reproduced: the right hand's top line is
  written for this module from the chords' own tones, and the left hand plays
  roots and fifths. The track title is used only to say which progression the
  study is of; the artists are credited in the README and nothing here claims
  any connection with them. The studies are GPL-3.0-or-later with everything else.

## Schwung's shim, for completeness

`schwung-shim.so` is conveyed under **GPL-3.0-or-later**, because it links
eSpeak NG for the screen reader. This module is under the same licence, so the
adjacency raises no question; it is still a separate work — its own repo, its
own tarball, `dlopen`ed by the host at runtime on the user's device.

