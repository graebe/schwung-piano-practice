// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
// From the neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/src/lib/fit.js).
/*
 * The window's scale, and the height it asks the host for.
 *
 * Every editor is a fixed design width scaled to whatever viewport the WebView
 * hands it: Live gives fewer CSS pixels than asked for, and a page that simply
 * overflowed cut the right-hand controls off. Scaling keeps every proportion.
 *
 * THE SCALE IS A SIGNAL. Each editor had its own fit() that wrote the transform
 * and returned a number, called once from an effect -- so after a host resize
 * the transform followed but the height sent to the plugin did not, because
 * nothing the effect read had changed. Here the scale is reactive and the
 * height is an effect of it.
 */
import { createSignal, createEffect, getOwner, onCleanup } from 'solid-js';

/** The factor that fits `designW` into `viewportW`: never below 0.1. */
export const fitScale = (viewportW, designW) =>
  Math.max(0.1, (viewportW || designW) / designW);

/** The host window height, in viewport pixels, for a design height at a scale. */
export const scaledHeight = (designH, scale) => Math.ceil(designH * scale);

/**
 * A reactive scale for a design `designW` wide. The resize listener is removed
 * with the owner that made it, or by `dispose()`.
 *
 * `win` is injectable so a test can drive it.
 */
export function createFit(designW, { win = globalThis.window } = {}) {
  const [scale, setScale] = createSignal(fitScale(win?.innerWidth, designW));
  const onResize = () => setScale(fitScale(win.innerWidth, designW));
  win?.addEventListener?.('resize', onResize);
  const dispose = () => win?.removeEventListener?.('resize', onResize);
  if (getOwner()) onCleanup(dispose);
  return { scale, dispose };
}

/**
 * Tell the plugin the height the editor needs whenever the design height OR
 * the scale moves -- once per distinct value. `designH` is an accessor.
 */
export function reportHeight(designH, scale, send) {
  let last = '';
  createEffect(() => {
    const h = designH();
    if (!(h > 0)) return;
    const msg = String(scaledHeight(h, scale()));
    if (msg !== last) {
      last = msg;
      send(msg);
    }
  });
}
