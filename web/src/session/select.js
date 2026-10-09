// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * select.js — which session the page drives.
 *
 * Inside Schwung's web manager the page is served by the Move and Schwung
 * injects its bridge (window.schwungRemote): the session is the Move's.
 * Anywhere else the page practises on its own. ?backend=local or
 * ?backend=schwung overrides the guess, for development.
 *
 * The local backend's piano needs an AudioWorklet, which needs a secure
 * context; served over plain HTTP from a Move it is never loaded, which is
 * right — there the Move makes the sound.
 */
export function chooseBackend({ search = '', bridge = null } = {}) {
  const forced = new URLSearchParams(search).get('backend');
  if (forced === 'local' || forced === 'schwung') return forced;
  return bridge ? 'schwung' : 'local';
}
