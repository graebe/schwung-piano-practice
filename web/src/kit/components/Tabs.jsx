// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
// From the neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/src/components/Tabs.jsx).
/*
 * Tabs.
 *
 * A VERTICAL STRIP, each tab a block of the height divided evenly, the text a
 * quarter turn so it reads bottom-to-top. The lit one is a uv fill with on-uv
 * text; the glow is a CSS rule on `.tab.on` rather than a class toggled here,
 * because two class toggles in one commit are not two paints and a WKWebView
 * deferred the second.
 *
 * A tablist to assistive technology: one tab in the tab order (the selected
 * one), the arrows move between them and select as they go.
 *
 * `infos`, parallel to `tabs`: what each one shows, for the hint bar.
 */
import { For } from 'solid-js';
import { tabMove } from '../lib/keys.js';
import { infoAttrs } from '../lib/info.js';

export function Tabs(props) {
  let strip;
  const onKeyDown = (e) => {
    const to = tabMove(e.key, props.active ?? 0, props.tabs.length);
    if (to === null) return;
    e.preventDefault();
    props.onSelect(to);
    strip?.querySelectorAll('.tab')[to]?.focus();
  };
  return (
    <div class="tabs" role="tablist" aria-orientation="vertical" ref={strip}
         aria-label={props.label} onKeyDown={onKeyDown}>
      <For each={props.tabs}>{(t, i) => (
        <button type="button" class="tab" role="tab"
                aria-selected={props.active === i()}
                tabindex={props.active === i() ? 0 : -1}
                classList={{ on: props.active === i() }}
                {...infoAttrs(props.infos?.[i()])}
                onClick={() => props.onSelect(i())}>
          <span class="tab-text t-hint">{t}</span>
        </button>
      )}</For>
    </div>
  );
}
