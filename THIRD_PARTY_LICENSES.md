# Third-party licences

Piano Practice is MIT (see [LICENSE](LICENSE)). One third-party library is
compiled into the shipped binary, and its notice has to travel with it.

## libm 0.2.16 — MIT

`dsp.so` links [`libm`](https://crates.io/crates/libm) for `sinf`, `powf`,
`expf` and `sqrtf`. The DSP is `no_std`, so it cannot call the platform's maths
library through Rust's standard library and uses this crate instead.

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

`libm` is the only dependency of any kind. There are no JavaScript packages —
`package.json` declares no `dependencies` and no `devDependencies`.

## Not third-party

- `src/vendor/host/plugin_api_v1.h` is Schwung's plugin API header
  ([charlesvestal/schwung](https://github.com/charlesvestal/schwung), MIT), kept
  here so the module builds without a checkout of the host.
- The exercises are traditional melodies in the public domain — Ode to Joy,
  Greensleeves, Für Elise, Minuet in G, Twinkle, Mary's Lamb, Frère Jacques,
  Jingle Bells — transcribed for this module.

## One thing to be aware of, which is not a conflict

`schwung-shim.so` is conveyed under **GPL-3.0-or-later**, because it links
eSpeak NG for the screen reader. This module is a separate work: its own repo,
its own tarball, no GPL code compiled in, and it is `dlopen`ed by the host at
runtime on the user's device rather than distributed combined with it. That is
the same footing as every other module in Schwung's catalog. It is written down
because the adjacency is real and is the one question a reviewer would ask.
