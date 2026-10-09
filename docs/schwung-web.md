# The web page on a Move — how the page and the device talk

The practice page (`web/`) talks to a *session* through one interface. Two
sessions implement it:

| | where the session runs | sound | input |
| --- | --- | --- | --- |
| **local** (`web/src/session/local.js`) | in the browser, beside the page | the module's piano as wasm, in an AudioWorklet | computer keys, Web MIDI, pointer |
| **schwung** (`web/src/session/schwung.js`) | on the Move, in `ui.js` | the Move | the Move's pads; the page's keys and buttons as actions |

Both are built. This page is about the second: how a page in Schwung's web
manager watches and steers a session that runs on the Move.

## How a tool's page reaches its module

Schwung's web manager (`move.local:7700`, Remote UI › Tool) shows a module's
`web_ui.html` in a sandboxed iframe (`allow-scripts allow-same-origin`, plain
HTTP), and injects `/static/schwung-remote-api.js`. For an overtake tool the
page and the module meet only in the tool's **DSP parameters**
(`schwung/docs/MODULES.md`, "Tool web UIs"):

- the manager asks `get_param("module_id")`; a DSP that answers with its id
  gets the page offered at all;
- `get_param("state")` is read as **one flat JSON object** — nested values are
  dropped, every value arrives as a string, 64KB at most;
- `get_param("rui_poll")` answers `rev:on:tick:bpm`; the manager reads `state`
  again only when `rev` moves (else it polls every 100–400ms);
- `setParam("overtake_dsp:<k>", v)` from the page reaches the DSP's
  `set_param(k, v)` (values under 256 bytes through a lossless ring).

There is no MIDI or note channel to the page, and no Web MIDI or AudioWorklet
in the iframe (no secure context). The Move makes the sound; the page shows
and steers.

## The contract, already in the code

- **The picture**: `src/view_model.mjs`. `viewModel(session)` is everything on
  screen; `encodeViewModel(vm)` is the flat object, one JSON string per field,
  that `state` must answer. `tests/view_model.test.mjs` holds every bundled
  song at every level under 64KB.
- **The steering**: `src/actions.mjs`. The page sends one action as
  `setParam("overtake_dsp:action", JSON)`; `applyAction(session, action)` is
  what carries it out — the same function the browser's own session uses.
- **The page's half**: `web/src/session/schwung.js` subscribes to
  `overtake_dsp:*`, decodes the fields, carries the playhead forward between
  updates (unless paused or waiting on a note), and dispatches actions.

## The device's half

```
 page (web_ui.html)          Schwung manager            piano DSP (remote.rs)        ui.js (remote.mjs)
 ──────────────────          ───────────────            ─────────────────────        ──────────────────
 setParam action    ──────►  web-set ring    ──────►    inbox (32 actions)  ◄──────  get('inbox'), paced
 onParamChange      ◄──────  state read      ◄──────    picture, rev        ◄──────  set('vm', …), paced
                             on rev change              rui_poll "rev:0:0:0"
```

**The DSP is a mailbox** (`dsp/piano/src/remote.rs`), and nothing more. It
never looks inside what it holds.

| param | who | what |
| --- | --- | --- |
| `module_id` (get) | manager | `piano-practice`: what makes the Tool tab offer the page |
| `vm` (set) | ui.js | the picture, `encodeViewModel(viewModel(S))` as JSON; moves `rev` |
| `stale` (set) | ui.js | moves `rev` without a picture (see *Watching*) |
| `state` (get) | manager | the picture as last set, or `{}` |
| `rui_poll` (get) | shim | `rev:0:0:0`; the transport fields are Move's and stay 0 |
| `action` (set) | page | one action, queued for ui.js; a full queue or a value over 255 bytes is refused whole |
| `inbox` (get) | ui.js | `w` or `-`, then the queued actions, one a line |

It allocates once, in `create` (the 128KB picture buffer), and copies bounded
bytes on the audio thread after that. The plugin shim bounds keys at 4KB and
values at 128KB, the host's own channel size.

**ui.js keeps the pace** (`src/remote.mjs`). Two host facts set it:

- A param read waits for the next audio block, about 3ms, which is longer than
  a frame. So the inbox is read once a second while nobody watches and five
  times a second while somebody does. It is the only read in `ui.js`;
  `tests/ui_contract.test.mjs` holds it to that one site, outside the draw.
- A param write in overtake mode is fire-and-forget into one shared slot, and
  is dropped when the slot is busy. The notes for the piano use the same slot.
  So the picture is never written on a tick that already wrote, and a write
  the host refused is retried on the next tick.

**Watching.** The DSP counts a page as open while the manager keeps reading
`state`, which it does only when `rev` moves. While a page watches, ui.js sends
the picture when it changes (at most every 300ms, the manager's own read
throttle) and at least once a second; that heartbeat keeps the DSP's
three-second watch alive. A change in the playhead's position alone waits for
the heartbeat, because the page carries the beat forward itself. While nobody
watches, nothing but a `stale` goes out every two seconds. That nudge lets a
page whose watch lapsed, for example over a stalled WiFi link, pull again and
be seen again.

**Actions** are applied with `applyAction(S, action)` (`src/actions.mjs`), the
function the browser's own session uses, so the Move's LEDs and panel follow
as they do for its buttons. A page cannot close the tool: `ui.js` ignores the
session's exit while it applies a page's action.

**Packaging.** `npm run web:build` writes `dist/web/web_ui.html` with relative
URLs. `scripts/package.sh` puts it beside `module.json`, with its `assets/`
(not the gallery's), the bundle's licence notices and the fonts' OFL texts.
Schwung serves them at `/api/remote-ui/module-assets/piano-practice/`.
`web_ui.html` loads the manager's bridge from `/static/schwung-remote-api.js`
before the app, and that bridge is what selects the Move's session. The wasm
and the worklet ship too, but on a Move they are never fetched.

## Tests

- `dsp/piano/src/remote.rs`: the mailbox, its bounds and the watch.
- `dsp/piano/src/lib.rs`: the params end to end, and proof that the sound is
  untouched.
- `tests/remote.test.mjs`: the pace (reads, heartbeat, one write a tick,
  retries, the 64KB limit).
- `tests/ui_trace.test.mjs`, scenario `page`: ui.js steered through a fake DSP
  and manager (`tests/support/fake_dsp.mjs`), recorded call for call. It checks
  that the page sees the drill armed, that its note sounds, and that its Back
  never closes the tool.
- `web/e2e`: `web_ui.html` with a fake bridge served at the manager's path.
