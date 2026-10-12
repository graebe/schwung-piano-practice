// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
// From the neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/src/components/Button.jsx).
/*
 * A button.
 *
 * The design's Button: a bg-200 well on a line-200 hairline, 28px tall
 * (control-h), `button` text, rising to bg-300 under the pointer, optionally led
 * by a 16px Icon at an 8px gap. `on` is the lit state -- uv fill, on-uv text --
 * which is also what a pressed button looks like: "selected is uv".
 *
 * AN ICON REPLACES A VERB, and only on a control that acts (transport,
 * copy/paste, export/import, loop, link, reset, power) -- never as decoration.
 * `icon` names a glyph from the design's set of fifteen; with no label the
 * button is the 28px square icon-only form, and then it carries the verb as
 * its aria-label and title.
 *
 * `info` is what it does, for the hint bar and as its accessible description.
 * A button that has one shows no native tooltip: two texts appearing for one
 * hover, a beat apart and in two places, is one too many. `title` then only
 * names an icon-only button.
 */
import { Show } from 'solid-js';
import { Icon } from './Icon.jsx';
import { infoAttrs } from '../lib/info.js';

export function Button(props) {
  const iconOnly = () => !!props.icon && !props.children;
  return (
    <button type="button" class="btn t-button"
            classList={{ on: props.on, icon: iconOnly() }}
            title={props.info ? undefined : props.title}
            aria-label={props.ariaLabel ?? (iconOnly() ? props.title : undefined)}
            aria-pressed={props.on === undefined ? undefined : !!props.on}
            disabled={!!props.disabled}
            {...infoAttrs(props.info)}
            onClick={props.onClick}>
      <Show when={props.icon}><Icon name={props.icon} /></Show>
      {props.children}
    </button>
  );
}
