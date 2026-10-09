// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
// From the neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/src/components/Toggle.jsx).
/*
 * A switch.
 *
 * THE SWITCH FORM: a 28x14 bg-200 housing with an 8x8 square at 2px that moves
 * to 16px and lights.
 *
 * The LED form (a round lens) is for state the plugin REPORTS; a user-settable
 * boolean is a switch. Getting it backwards would say the plugin is telling you
 * something when in fact it is asking.
 *
 * A BUTTON, NOT A DIV WITH AN onClick. It was the latter, which cannot be
 * focused or reached from the keyboard at all -- so the focus ring the design
 * system specifies had nowhere to land and `tab` skipped straight over it. A
 * button is the thing this already was; it brings focus, Space and Enter with
 * it and costs a style reset.
 *
 * `info`: what it does, for the hint bar and as its accessible description.
 */
import { infoAttrs } from '../lib/info.js';

export function Toggle(props) {
  const on = () => !!props.value;
  return (
    <button type="button" class="switch-row"
            role="switch" aria-checked={on()} {...infoAttrs(props.info)}
            disabled={!!props.disabled}
            onClick={() => !props.disabled && props.onChange?.(!on())}>
      <div class="switch" classList={{ on: on() }}>
        <div class="switch-knob" classList={{ 'glow-led': on() }} />
      </div>
      <span class="switch-label t-label">{props.label}</span>
    </button>
  );
}
