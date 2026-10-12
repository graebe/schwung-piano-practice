// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * main.jsx — which session the page drives, and the page itself.
 *
 * In a browser on its own: the module's session runs here, with the Move's
 * piano compiled to wasm and the exercises bundled into the page. Inside
 * Schwung's web manager, where Schwung injects its bridge: the session is the
 * Move's (web/src/session/select.js). Either way the page is the same App.
 */
import { render } from 'solid-js/web';

import './styles/tokens.gen.css';
import './styles/base.css';
import './kit/components.css';
import './music/music.css';
import './app/app.css';

import { App } from './app/App.jsx';
import { chooseBackend } from './session/select.js';
import { createLocalSession, bundleExercises } from './session/local.js';
import { createSchwungSession } from './session/schwung.js';
import { createPianoEngine } from './audio/engine.js';
import wasmUrl from '../../build/wasm/piano.wasm?url';
import workletUrl from './audio/piano-worklet.js?url';

/* Imported as JSON, so the build minifies them; the session reads text. */
const exercises = bundleExercises(import.meta.glob('../../src/exercises/*.json',
  { import: 'default', eager: true }));

/* localStorage can be missing or refuse (a private window, a sandbox): the
 * session then practises without remembering. */
function storage() {
  try {
    const s = window.localStorage;
    s.getItem('piano-practice:probe');
    return s;
  } catch (e) {
    return null;
  }
}

const bridge = window.schwungRemote || null;
let piano = null;
let backend;
if (chooseBackend({ search: location.search, bridge }) === 'schwung') {
  backend = createSchwungSession({ bridge });
} else {
  piano = createPianoEngine({ wasmUrl, workletUrl });
  backend = createLocalSession({ piano, storage: storage(), exercises });
}
backend.start();
window.addEventListener('pagehide', () => backend.stop());

render(() => <App backend={backend} piano={piano} />, document.getElementById('app'));
