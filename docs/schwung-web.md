# The web page on a Move — what is built, and what the device still needs

The practice page (`web/`) talks to a *session* through one interface. Two
sessions implement it:

| | where the session runs | sound | input |
| --- | --- | --- | --- |
| **local** (`web/src/session/local.js`) | in the browser, beside the page | the module's piano as wasm, in an AudioWorklet | computer keys, Web MIDI, pointer |
| **schwung** (`web/src/session/schwung.js`) | on the Move, in `ui.js` | the Move | the Move's pads; the page's keys and buttons as actions |

The local session is complete. The Move's is built and tested on the page's
side against a fake bridge; **the device side below is not built yet**.

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

## What the device still needs

1. **The DSP answers `module_id`** with `piano-practice`, and keeps two
   strings it is handed: `state` and `poll`.
   - `set_param("vm", json)` stores the encoded view model.
   - `set_param("poll", "rev:on:tick:bpm")` stores the poll line.
   - `get_param("state")` and `get_param("rui_poll")` answer them.
   - `set_param("action", json)` queues it for `ui.js`. Keep at most a few,
     in order.

   All of this is copying bytes, no allocation on the audio thread: fixed
   buffers in the `piano` adapter, beside `n`, `panic` and `gain`.

2. **`ui.js` publishes.** When the session marks a change that the page shows
   (not on every scroll tick), it writes `encodeViewModel(viewModel(S))`
   through `host_module_set_param("vm", …)`, and the poll line with a new
   `rev`.
   - **The parameter channel is a single-slot mailbox.** The note list `n`
     and the view model written in the same tick overwrite each other. Write
     at most one parameter per tick: notes first, the view model on the next
     free tick, by `rev` diff.
   - The chart is the bulk of the payload and changes only when something is
     armed. If the host's limit on one value turns out to be below what a
     song needs, send `chart` as its own key, by `chartRev`. Measure first.

3. **`ui.js` takes actions.** This is the one open question: how a page's
   action gets from the DSP back to `ui.js`.
   - A `get_param` costs ~2.8ms and is banned from the frame path.
   - So either `ui.js` polls a single `action` key at a slow, throttled rate
     outside the draw, or the DSP forwards actions as internal MIDI
     (e.g. SysEx on a private cable) that `onMidiMessageInternal` decodes.
   - Whichever lands, it ends in `applyAction(S, action)`, and the Move's own
     LEDs and panel follow as they do for its buttons.

4. **Packaging.**
   - `npm run web:build` writes `dist/web/web_ui.html` and `assets/` with
     relative URLs.
   - `scripts/package.sh` copies them into the module folder. Schwung serves
     them at `/api/remote-ui/module-assets/piano-practice/`.
   - The wasm and the worklet are fetched only by the local session, so on a
     Move they are never loaded. They could be left out of the tarball to
     save space.

5. **Tests on the device side.**
   - The trace test gains a scenario where a page steers.
   - A golden `state` per screen.
   - The 64KB check, run against the real host limit once measured.
