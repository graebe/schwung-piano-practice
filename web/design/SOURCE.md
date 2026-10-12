# Where the design comes from

The browser UI is drawn in **Ultraviolet 1.1.0**, the Neon Ingvy design system
(published as *Design Scheme*: https://claude.ai/artifact/PWHRCrxgsWTm2g8in642gZ;
plugin layouts as *Designs*: https://claude.ai/artifact/3yBz5KS6LVCBBHSmbae13v).

Its mirror lives in the plugin repository, `vst/neon-ingvy-audio-plugins`
(github.com/graebe/neon-ingvy-audio-plugins), under `design/scheme/project/`.
The files here are copies of that mirror at commit
`bc8c8d0892d42178b737ba5abc97e29d7467c95c`, byte for byte:

| Here | There | SHA-256 |
| --- | --- | --- |
| `ultraviolet-tokens.json` | `design/scheme/project/tokens.json` (`lastChange` 2026-10-06, release 1.1.0) | `9d70223feadeb1050af2a9f19acd32044f64dfde1596993a8f5e04ca56ece1b7` |
| `ultraviolet-ground-grain.png` | `plugins/_shared/ui/assets/ground-grain.png`, the grain tile that repository's `scripts/gen-tokens.mjs` takes out of `design/scheme/project/components/bundle.css` | `ff1706e0056eb2a3b1bd73243e7c36d0d87f375dc818391b2a552dfa16d7d94b` |
| `icons/*.svg` | `design/scheme/project/assets/Icons/*.svg`, the fifteen glyphs | |

`practice-tokens.json` is not a copy: it is this app's additions to the system
(the answer-pad colours, which are a picture of Move's hardware), held to the
same generator and reviewed against the release it names.

## Updating

1. Compare `design-system.json`'s `lastChange` in the plugin repository with
   the one above. Compare the token **values** before anything else: if none
   moved, nothing already built can break.
2. Copy the files in the table again, from the new commit, and update the
   commit and sums here.
3. `node scripts/gen-tokens.mjs`, which rewrites `web/src/styles/tokens.gen.css`
   and stops, naming the token, on any shape it has no rule for. If the release
   changed it also stops on `practice-tokens.json` until that file's `release`
   is set to the new one, after a look at whether its colours still sit in it.
4. `node --test web/test/*.test.mjs`.

## Fonts

| File | From | Licence |
| --- | --- | --- |
| `../fonts/JetBrainsMono-{Regular,Medium}.woff` | the ui-kit at commit `4e15cc8` (`ui-kit/src/fonts`), JetBrains Mono subset to Latin by that repository's `scripts/subset-fonts.sh` | SIL OFL 1.1, `../fonts/OFL.txt` |
| `../fonts/NINotation.woff` | Bravura 1.482 (`plugins/_shared/ui/fonts/bravura/Bravura.otf`, SHA-256 `cdf0f893…5f3b`), subset to the SMuFL glyphs the staff draws and renamed by `scripts/subset-fonts.sh` | SIL OFL 1.1, `../fonts/Bravura-OFL.txt` |

The notation font is a Modified Version of Bravura under the OFL, so it does
not carry the Reserved Font Name: it is called **NI Notation**, and its
copyright notice, licence and trademark notice are Bravura's, unchanged.
